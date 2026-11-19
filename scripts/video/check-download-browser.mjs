import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';

export async function checkDownloadBrowser(base, projectId, root, live, importTitle) {
  const profile = join(root, 'browser');
  const browser = spawn(process.env.MOWO_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  const pending = new Map(); let id = 0, socket;
  const delay = ms => new Promise(accept => setTimeout(accept, ms));
  const cdp = (method, params = {}) => new Promise((accept, reject) => {
    const current = ++id;
    const timer = setTimeout(() => { pending.delete(current); reject(new Error('Browser timeout: ' + method)); }, 20000);
    pending.set(current, { accept, reject, timer }); socket.send(JSON.stringify({ id: current, method, params }));
  });
  const evaluate = async expression => {
    const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!value.exceptionDetails, 'browser action must succeed'); return value.result.value;
  };
  const until = async (expression, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(150); }
    throw new Error('Browser state did not arrive: ' + expression);
  };
  try {
    let port;
    for (let retry = 0; retry < 100; retry++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); } }
    assert.ok(port);
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data); const entry = pending.get(data.id); if (!entry) return;
      pending.delete(data.id); clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error('Browser protocol failure')); else entry.accept(data.result);
    });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `${base}/canvas/${projectId}` });
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.startsWith('下载视频'))`);
    await until(`!!document.querySelector('.react-flow__pane')`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('下载视频')).click()`);
    await until(`document.querySelector('[role=dialog]')?.textContent.includes('本项目下载记录')`);
    assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), '关闭视频下载');
    if (importTitle) {
      const item = `Array.from(document.querySelectorAll('[role=dialog] article')).find(a=>a.querySelector('strong')?.textContent===${JSON.stringify(importTitle)})`;
      await until(`${item}?.textContent.includes('导入素材库')`);
      await evaluate(`Array.from(${item}.querySelectorAll('button')).find(b=>b.textContent==='预览视频').click()`);
      await until(`document.querySelector('[role=dialog] video')?.readyState>=2`);
      assert.ok(await evaluate(`(async()=>{const v=document.querySelector('[role=dialog] video');v.muted=true;await v.play();v.pause();return v.videoWidth>0})()`));
      await evaluate(`Array.from(${item}.querySelectorAll('button')).find(b=>b.textContent==='导入素材库').click()`);
      await until(`${item}?.textContent.includes('已导入')`);
      await evaluate(`Array.from(${item}.querySelectorAll('button')).find(b=>b.textContent==='查看素材库').click()`);
      await until(`!document.querySelector('[role=dialog]')`);
      const card = `Array.from(document.querySelectorAll('article[draggable=true]')).find(a=>a.textContent.includes(${JSON.stringify(importTitle)}))`;
      await until(`${card}?.querySelector('img')?.naturalWidth>0`);
      await evaluate(`(()=>{const card=${card};const transfer=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));const canvas=document.querySelector('.react-flow');const box=canvas.getBoundingClientRect();canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:box.left+box.width/2,clientY:box.top+box.height/2}));})()`);
      await until(`document.querySelector('.react-flow__node video')?.readyState>=2`);
      assert.equal(await evaluate(`document.querySelector('.react-flow__node video').paused`), true);
      const dimensions = await evaluate(`(async()=>{const v=document.querySelector('.react-flow__node video');v.muted=true;await v.play();v.pause();return {width:v.videoWidth,height:v.videoHeight}})()`);
      assert.ok(dimensions.width > 0 && dimensions.height > 0);
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(root, 'import-and-canvas.png'), Buffer.from(screenshot.data, 'base64'));
      console.log('Browser import passed: preview decodes, explicit import, asset cover, drag to canvas paused, real playback.');
      return;
    }
    if (live) {
      await evaluate(`(()=>{const input=document.querySelector('input[aria-label="B站视频链接"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'BV1bv411T7et');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(`!Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='解析链接').disabled`);
      await evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='解析链接').click()`);
      await until(`document.querySelectorAll('[role=dialog] select').length===2`, 150000);
      assert.ok(await evaluate(`document.querySelectorAll('[role=dialog] select')[1].selectedOptions[0].textContent.includes('H.264')`));
      await evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='开始下载').click()`);
      await until(`document.querySelector('[role=dialog]').textContent.includes('P1 ·')`, 15000);
    }
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, 'download-modal.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate(`document.querySelector('button[aria-label="关闭视频下载"]').click()`);
    await until(`!document.querySelector('[role=dialog]')`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('下载视频')).click()`);
    await until(`document.querySelector('[role=dialog]')?.textContent.includes('本项目下载记录')`);
    if (live) await until(`document.querySelector('[role=dialog]').textContent.includes('P1 ·')`);
    console.log('Browser download modal passed: open, focus, close/reopen, history' + (live ? ', real resolve, H.264 default, start download' : '') + '.');
  } catch (error) {
    if (socket?.readyState === WebSocket.OPEN) {
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (screenshot) await writeFile(join(root, 'browser-failure.png'), Buffer.from(screenshot.data, 'base64'));
      console.log('Browser state:', await evaluate(`JSON.stringify({nodes:document.querySelectorAll('.react-flow__node').length,video:Array.from(document.querySelectorAll('video')).map(v=>({src:v.getAttribute('src'),state:v.readyState,error:v.error?.code})),alert:Array.from(document.querySelectorAll('[role=alert]')).map(e=>e.textContent)})`).catch(() => 'unavailable'));
    }
    throw error;
  } finally {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Browser closed')); }
    socket?.close();
    if (browser.exitCode === null && browser.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); await once(killer, 'exit');
    }
  }
}
