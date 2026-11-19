import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const file = resolve(process.argv[2]);
const size = (await stat(file)).size;
const profile = await mkdtemp(resolve('data/video-runtime/browser-'));
let ranges = 0;
const server = createServer((req, res) => {
  if (req.url !== '/media') {
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><video id="v" muted playsinline src="/media"></video>'); return;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
  const headers = { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
  if (match) { ranges++; headers['Content-Range'] = `bytes ${start}-${end}/${size}`; }
  res.writeHead(match ? 206 : 200, headers);
  const stream = createReadStream(file, { start, end });
  res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = spawn(process.env.MOWO_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
const pending = new Map(); let id = 0;
const delay = ms => new Promise(accept => setTimeout(accept, ms));
async function cdp(method, params = {}) {
  const current = ++id;
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => { pending.delete(current); reject(new Error('Browser timeout: ' + method)); }, 20000);
    pending.set(current, { accept, reject, timer }); socket.send(JSON.stringify({ id: current, method, params }));
  });
}
try {
  let port;
  for (let retry = 0; retry < 100; retry++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome debugging endpoint must start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data); const entry = pending.get(data.id); if (!entry) return;
    pending.delete(data.id); clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error('Browser protocol failure')); else entry.accept(data.result);
  });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  let result;
  for (let retry = 0; retry < 60; retry++) {
    const state = await cdp('Runtime.evaluate', { expression: 'document.getElementById("v")?.readyState >= 2', returnByValue: true });
    if (state.result.value) break;
    await delay(100);
  }
  result = await cdp('Runtime.evaluate', { expression: `(async()=>{
    const v=document.getElementById('v');if(!v||v.error)throw Error('media failed');
    const frame=new Promise((accept,reject)=>{const t=setTimeout(()=>reject(Error('decode timeout')),8000);v.requestVideoFrameCallback(()=>{clearTimeout(t);accept(true)})});
    await v.play();await frame;
    await new Promise((accept,reject)=>{const t=setTimeout(()=>reject(Error('seek timeout')),8000);v.addEventListener('seeked',()=>{clearTimeout(t);accept()},{once:true});v.currentTime=v.duration/2});
    v.pause();return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,time:v.currentTime,decoded:true};
  })()`, awaitPromise: true, returnByValue: true });
  assert.ok(!result.exceptionDetails, 'browser must decode and seek the preview');
  assert.ok(result.result.value.decoded && result.result.value.time > 0 && ranges > 0);
  console.log(JSON.stringify({ ...result.result.value, rangeRequests: ranges }));
} finally {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Browser closed')); }
  socket?.close(); server.closeAllConnections(); server.close();
  if (browser.exitCode === null && browser.pid) {
    if (process.platform === 'win32') {
      const stop = spawn('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(stop, 'exit');
    } else browser.kill();
  }
}
