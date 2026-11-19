import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/video/verify-shot-real.mjs <video.mp4>');
const input = resolve(source);
const inputStat = await stat(input);
const root = await mkdtemp(resolve('data/video-runtime/shot-real-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(accept => probe.close(accept));
const base = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '--webpack',
  '-H', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, MOWO_DATA_ROOT: join(root, 'data'), MOWO_NEXT_DIST_DIR: '.next-shot-real-test' } });
let logs = '';
for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-3000); });
const delay = ms => new Promise(accept => setTimeout(accept, ms));
let browser;
async function openBrowser(url) {
  const profile = join(root, 'browser');
  const browserProcess = spawn(process.env.MOWO_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  let socket;
  const pending = new Map();
  let nextId = 0;
  try {
    let chromePort;
    for (let i = 0; i < 120; i++) {
      try { chromePort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
      catch { await delay(100); }
    }
    assert.ok(chromePort, 'Chrome debugging port unavailable');
    const tabs = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.accept(message.result);
    });
    const cdp = (method, params = {}) => new Promise((accept, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 30000);
      pending.set(id, { accept, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    const until = async (expression, timeout = 60000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await delay(200);
      }
      throw new Error(`Browser state did not arrive: ${expression}`);
    };
    await cdp('Page.navigate', { url });
    return { process: browserProcess, socket, evaluate, until, cdp };
  } catch (error) {
    socket?.close(); browserProcess.kill();
    throw error;
  }
}
try {
  let ready = false;
  for (let i = 0; i < 120 && app.exitCode === null; i++) {
    try { ready = (await fetch(base + '/api/projects', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, logs);
  const created = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Real shot analysis verification' }) });
  const creation = await created.json();
  assert.equal(created.status, 201, JSON.stringify(creation));
  const { project } = creation;
  assert.ok(project?.id);
  const imported = await fetch(`${base}/api/projects/${project.id}/videos?name=shot-test.mp4`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': String(inputStat.size) },
    body: createReadStream(input), duplex: 'half', signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const result = await imported.json();
  assert.equal(imported.status, 201, JSON.stringify(result));
  const assetId = result.asset.id;
  const editorUrl = `${base}/video-editor/${project.id}/${assetId}`;
  assert.equal((await fetch(editorUrl)).status, 200);
  const indexUrl = `${base}/api/projects/${project.id}/video-editor/${assetId}/index`;
  const shotsUrl = `${base}/api/projects/${project.id}/video-editor/${assetId}/shots`;
  assert.equal((await (await fetch(shotsUrl)).json()).status, 'idle');
  assert.equal((await fetch(indexUrl, { method: 'POST' })).status, 202);
  let index;
  for (let i = 0; i < 360; i++) {
    index = await (await fetch(indexUrl)).json();
    if (index.status === 'ready' || index.status === 'failed') break;
    await delay(500);
  }
  assert.equal(index?.status, 'ready', JSON.stringify(index));
  assert.equal((await (await fetch(shotsUrl)).json()).status, 'idle', 'indexing must not start detection');
  if (process.argv.includes('--browser')) {
    browser = await openBrowser(editorUrl);
    await browser.until(`document.body?.textContent.includes('已索引 ${index.metadata.frameCount} 帧')`);
    await browser.until(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='开始分镜')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[aria-label="镜头列表"] button').length`), 0);
    await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='开始分镜').click()`);
    let clicked = false;
    for (let i = 0; i < 20; i++) {
      clicked = (await (await fetch(shotsUrl)).json()).status !== 'idle';
      if (clicked) break;
      await delay(250);
    }
    assert.ok(clicked, 'browser click must start shot analysis');
  } else assert.equal((await fetch(shotsUrl, { method: 'POST' })).status, 202);
  let shots;
  for (let i = 0; i < 360; i++) {
    shots = await (await fetch(shotsUrl)).json();
    if (shots.status === 'ready' || shots.status === 'failed') break;
    await delay(500);
  }
  assert.equal(shots?.status, 'ready', JSON.stringify(shots));
  assert.equal(shots.frameCount, index.metadata.frameCount);
  assert.ok(['cpu', 'dml'].includes(shots.device), 'completed task must report its execution device');
  assert.ok(shots.cuts.every((cut, i) => cut.frame > (shots.cuts[i - 1]?.frame ?? 0)));
  if (browser) {
    await browser.until(`document.querySelectorAll('[aria-label="镜头列表"] button').length===${shots.cuts.length + 1}`);
    await browser.evaluate(`document.querySelectorAll('[aria-label="镜头列表"] button')[1].click()`);
    await browser.until(`!!document.querySelector('img[alt="源视频第 ${shots.cuts[0].frame} 帧"]')`, 60000);
    assert.equal(await browser.evaluate(`document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow')`),
      String(shots.cuts[0].frame));
    await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='校正分镜').click()`);
    await browser.until(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='结束校正')`);
    const canvas = await browser.evaluate(`(()=>{ const r=document.querySelector('canvas[role="slider"]').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
    const testCutIndex = Math.floor(shots.cuts.length / 2);
    const cutX = canvas.x + canvas.w * shots.cuts[testCutIndex].frame / shots.frameCount;
    const y = canvas.y + 40;
    assert.equal(await browser.evaluate(`document.elementFromPoint(${cutX},${y})?.tagName`), 'CANVAS');
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cutX, y });
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: cutX, y, button: 'left', clickCount: 1 });
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cutX + 4, y, button: 'left', buttons: 1 });
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cutX + 4, y, button: 'left', clickCount: 1 });
    await browser.until(`fetch('${shotsUrl}').then(r=>r.json()).then(s=>s.editRevision===1)`);
    assert.notEqual((await (await fetch(shotsUrl)).json()).cuts[testCutIndex].frame, shots.cuts[testCutIndex].frame);
    await browser.until(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='撤回 Ctrl+Z' && !button.disabled)`);
    await browser.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await browser.until(`fetch('${shotsUrl}').then(r=>r.json()).then(s=>s.editRevision===2)`);
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cutX, y });
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: cutX, y, button: 'left', clickCount: 1 });
    await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cutX, y, button: 'left', clickCount: 1 });
    await browser.until(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='删除所选切点' && !button.disabled)`);
    await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='删除所选切点').click()`);
    await browser.until(`document.querySelectorAll('[aria-label="镜头列表"] button').length===${shots.cuts.length}`);
    assert.equal((await (await fetch(shotsUrl)).json()).cuts.length, shots.cuts.length - 1);
    await browser.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await browser.until(`document.querySelectorAll('[aria-label="镜头列表"] button').length===${shots.cuts.length + 1}`);
    const restored = await (await fetch(shotsUrl)).json();
    assert.deepEqual(restored.cuts.map(cut => cut.frame), shots.cuts.map(cut => cut.frame));
    assert.equal(restored.manuallyEdited, true);
    assert.equal(restored.editRevision, 4);
    assert.equal((await fetch(shotsUrl, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cuts: [0], expectedRevision: restored.editRevision }) })).status, 409);
    console.log('Browser shot correction passed: drag, delete, Ctrl+Z, persistent revision and shot list sync.');
  }
  const firstFrame = await fetch(`${base}/api/projects/${project.id}/video-editor/${assetId}/frames/0`);
  assert.equal(firstFrame.status, 200, 'first shot thumbnail must load');
  console.log(JSON.stringify({ frameCount: shots.frameCount, cutCount: shots.cuts.length, device: shots.device,
    firstCuts: shots.cuts.slice(0, 8).map(cut => cut.frame), firstFrameBytes: (await firstFrame.arrayBuffer()).byteLength }));
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (browser) {
    browser.socket.close();
    if (browser.process.exitCode === null && browser.process.pid) {
      const closed = once(browser.process, 'close');
      const stop = spawn('taskkill.exe', ['/PID', String(browser.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(stop, 'exit');
      await closed;
    }
  }
  if (app.exitCode === null) {
    const closed = once(app, 'close');
    if (process.platform === 'win32' && app.pid) {
      const stop = spawn('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(stop, 'exit');
    } else app.kill('SIGTERM');
    await closed;
  }
  const parent = await realpath(resolve('data/video-runtime'));
  const target = await realpath(root);
  assert.ok(target.startsWith(parent + '\\') && target !== parent, 'cleanup must stay in test runtime');
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await rm(target, { recursive: true, force: true }); break; }
    catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error?.code) || attempt === 19) throw error;
      await delay(250);
    }
  }
}
