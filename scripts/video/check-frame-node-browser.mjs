import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function checkFrameNodeBrowser(base, projectId, asset, root) {
  function canvas(asset, nodeId = 'frame-ui') {
    return { schemaVersion: 1, nodes: [
      { id: 'video-ui', type: 'module', position: { x: 0, y: 0 }, data: { moduleType: 'video', assetId: asset.id, title: 'UI sample', previewUrl: asset.previewUrl }, style: { width: 280, height: 180 } },
      { id: nodeId, type: 'module', position: { x: 360, y: 0 }, data: { moduleType: 'video-frame-extraction' }, style: { width: 380 } },
    ], edges: [{ id: 'video-ui-edge', source: 'video-ui', sourceHandle: 'video', target: nodeId, targetHandle: 'video-sources' }], viewport: { x: 30, y: 100, zoom: .8 } };
  }
  async function save(document) {
    const response = await fetch(`${base}/api/projects/${projectId}/canvas`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document) });
    assert.equal(response.status, 200, await response.text());
  }
  const jobs = async node => (await (await fetch(`${base}/api/projects/${projectId}/video-frame-jobs?nodeId=${node}`)).json()).jobs;
  await save(canvas(asset));
  const profile = join(root, 'frame-browser');
  const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--window-size=1600,1100', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket, serial = 0; const pending = new Map();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    let port;
    for (let i = 0; i < 100; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); } }
    assert.ok(port);
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
    socket.addEventListener('message', event => { const msg = JSON.parse(event.data); const entry = pending.get(msg.id); if (entry) { pending.delete(msg.id); clearTimeout(entry.timer); if (msg.error) entry.reject(new Error(JSON.stringify(msg.error))); else entry.accept(msg.result); } });
    const cdp = (method, params = {}) => new Promise((accept, reject) => { const id = ++serial; const timer = setTimeout(() => reject(new Error(method + ' timeout')), 30000); pending.set(id, { accept, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const until = async expression => { const deadline = Date.now() + 90000; while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(200); } throw new Error('Missing browser state: ' + expression + '\n' + await evaluate('document.body.innerText')); };
    const click = label => evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw new Error('Missing enabled button');b.click();b.click();})()`);
    await cdp('Page.navigate', { url: `${base}/canvas/${projectId}` });
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='生成图片组（1 个视频）'&&!b.disabled)`);
    assert.equal((await jobs('frame-ui')).length, 0, 'Connection must not create analysis or extraction jobs');
    const beforeDrag = await evaluate(`(()=>{const n=document.querySelector('[data-id="frame-ui"]'),r=n.getBoundingClientRect(),h=n.querySelector('form > div').getBoundingClientRect();return {x:r.x,y:r.y,px:h.x+h.width/2,py:h.y+h.height/2};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeDrag.px, y: beforeDrag.py });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeDrag.px, y: beforeDrag.py, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeDrag.px + 20, y: beforeDrag.py + 10, buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeDrag.px + 65, y: beforeDrag.py + 35, buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeDrag.px + 65, y: beforeDrag.py + 35, button: 'left', clickCount: 1 });
    await delay(200);
    assert.ok(await evaluate(`Math.abs(document.querySelector('[data-id="frame-ui"]').getBoundingClientRect().x-${beforeDrag.x})>30`), 'Card body must drag');
    const control = await evaluate(`(()=>{const n=document.querySelector('[data-id="frame-ui"]'),r=n.getBoundingClientRect(),i=n.querySelector('[aria-pressed]').getBoundingClientRect();return {x:r.x,px:i.x+i.width/2,py:i.y+i.height/2};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: control.px, y: control.py, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: control.px + 30, y: control.py + 10, buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: control.px + 30, y: control.py + 10, button: 'left', clickCount: 1 });
    assert.ok(await evaluate(`Math.abs(document.querySelector('[data-id="frame-ui"]').getBoundingClientRect().x-${control.x})<2`), 'Controls must not drag');
    await click('拍摄视频');
    await click('生成图片组（1 个视频）');
    await until(`document.querySelectorAll('.react-flow__node-group').length===2 && document.body.textContent.includes('已生成 12 张图片')`);
    assert.equal((await jobs('frame-ui')).length, 1);
    await click('恢复图片组');
    await delay(1800); await cdp('Page.reload');
    await until(`document.querySelectorAll('.react-flow__node-group').length===2 && document.body.textContent.includes('已生成 12 张图片')`);
    assert.equal((await jobs('frame-ui')).length, 1);
    await click('动画');
    await click('重新生成图片组（1 个视频）');
    await until(`document.body.textContent.includes('动画节奏暂时无法自动确定')`);
    assert.equal(await evaluate(`document.querySelectorAll('.react-flow__node-group').length`), 2);
    await click('确认帧率并继续');
    await until(`document.querySelectorAll('.react-flow__node-group').length===4 && document.body.textContent.includes('已生成 6 张图片')`);
    assert.equal((await jobs('frame-ui')).length, 2, 'Confirm rate must resume same job');

    const longPath = join(root, 'long-browser.mp4');
    await promisify(execFile)(resolve('data/video-runtime/tools/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=48', '-frames:v', '242', '-c:v', 'libx264', longPath], { windowsHide: true });
    const response = await fetch(`${base}/api/projects/${projectId}/videos?name=long-browser.mp4`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await readFile(longPath) });
    const long = await response.json(); assert.equal(response.status, 201, JSON.stringify(long));
    // Settle the existing canvas save before replacing the isolated fixture.
    await delay(1800); await save(canvas(long.asset, 'frame-over'));
    await cdp('Page.reload');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='生成图片组（1 个视频）'&&!b.disabled)`);
    assert.equal((await jobs('frame-over')).length, 0);
    await click('拍摄视频'); await click('生成图片组（1 个视频）');
    await until(`document.body.textContent.includes('处理后共 242 张，超过 150 张上限')`);
    assert.equal(await evaluate(`document.querySelectorAll('.react-flow__node-group').length`), 0);
    const waiting = (await jobs('frame-over'))[0]; assert.equal(waiting.resultTaskId, null);
    await click('抽帧');
    await until(`document.body.textContent.includes('选取后共 121 张')`);
    const picture = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile('docs/design/prototypes/video-frame-node-v01.png', Buffer.from(picture.data, 'base64'));
    await click('确认抽帧并输出');
    await until(`document.querySelectorAll('.react-flow__node-group').length===2 && document.body.textContent.includes('已生成 121 张图片')`);
    const after = await jobs('frame-over'); assert.equal(after.length, 1); assert.equal(after[0].id, waiting.id);
    await click('恢复图片组'); await delay(1800); await cdp('Page.reload');
    await until(`document.querySelectorAll('.react-flow__node-group').length===2 && document.body.textContent.includes('已生成 121 张图片')`);
    assert.equal((await jobs('frame-over')).length, 1);
    await delay(1800); await save(canvas(long.asset, 'frame-cap'));
    await cdp('Page.reload');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='生成图片组（1 个视频）'&&!b.disabled)`);
    await click('拍摄视频'); await click('生成图片组（1 个视频）');
    await until(`document.body.textContent.includes('处理后共 242 张，超过 150 张上限')`);
    await click('仅输出前 150 帧');
    await until(`document.querySelectorAll('.react-flow__node-group').length===2 && document.body.textContent.includes('已生成 150 张图片')`);
    assert.equal((await jobs('frame-cap')).length, 1);
    await click('进入编辑页裁剪');
    await until(`window.location.pathname.startsWith('/video-editor/')`);
    console.log('Browser passed: no job on connection, drag, video direct output, animation rate confirmation, overflow selection and same-batch recovery without duplicates.');
  } finally { socket?.close(); browser.kill(); for (const entry of pending.values()) clearTimeout(entry.timer); }
}
