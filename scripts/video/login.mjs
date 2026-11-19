import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeEngine } from './engine-client.mjs';

const token = randomBytes(32).toString('hex');
const script = fileURLToPath(new URL('./auth.py', import.meta.url));
const credentialFile = resolve('data/video-runtime/bilibili.credentials');
let key;
let image;
let expiresAt = 0;
let generation = 0;
let busy = false;
let origin;
const abort = new AbortController();
const invoke = (request) => invokeEngine({ ...request, credentialFile }, { script, signal: abort.signal });
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MOWO B站登录验证</title>
<style>body{font:16px system-ui;max-width:600px;margin:60px auto;padding:20px;color:#222}button{padding:10px;margin:8px}img{display:block;width:260px;height:260px;object-fit:contain}p{line-height:1.7}</style>
<h1>B站扫码登录验证</h1><p>请用 B站 App 扫码并在手机上确认。登录状态加密保存在本机；可随时退出。</p>
<button id="generate">生成／刷新二维码</button><button id="check">校验已保存登录状态</button><button id="logout">退出登录</button>
<p id="status">尚未开始</p><img id="qr" hidden alt="B站登录二维码"><p>此页面仅用于当前技术验证，10 分钟后关闭服务。</p>
<script>
const text = document.getElementById('status'); const qr = document.getElementById('qr'); let polling=false; let active=false;
const labels={waiting:'等待扫码',scanned:'已扫码，请在手机确认',expired:'二维码已过期，请刷新',success:'已登录，凭据已加密保存',loggedIn:'登录校验通过',anonymous:'未登录或登录已失效'};
async function command(action){const r=await fetch('/'+action,{method:'POST',headers:{'X-Mowo-Token':'${token}'}}); const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
async function execute(action){if(polling)return;polling=true;try{const d=await command(action);text.textContent=labels[d.status]||d.status;if(d.image){qr.src='data:image/png;base64,'+d.image;qr.hidden=false;}if(['expired','success','anonymous','loggedIn'].includes(d.status)){active=false;qr.hidden=true;}if(action==='generate')active=true;}catch(e){text.textContent='操作失败：'+e.message;if(action!=='poll')active=false;}finally{polling=false;}}
document.getElementById('generate').onclick=()=>execute('generate');document.getElementById('check').onclick=()=>execute('status');document.getElementById('logout').onclick=()=>execute('logout');
setInterval(()=>{if(active&&!polling)execute('poll')},1800);
</script></html>`;

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
  if (request.method === 'GET' && request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(page); return;
  }
  response.setHeader('Content-Type', 'application/json');
  const reply = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
  if (request.method !== 'POST' || request.headers['x-mowo-token'] !== token ||
      (request.headers.origin && request.headers.origin !== origin)) { reply(403, { error: 'request_rejected' }); return; }
  if (busy) { reply(409, { error: 'operation_pending' }); return; }
  busy = true;
  try {
    if (request.url === '/generate') {
      const version = ++generation;
      key = undefined; image = undefined;
      const event = (await invoke({ action: 'generate' }))[0];
      if (version !== generation) throw new Error('login_changed');
      key = event.key; image = event.image; expiresAt = Date.now() + 180000;
      reply(200, { status: 'waiting', image });
    } else if (request.url === '/poll') {
      if (!key || Date.now() >= expiresAt) { key = undefined; image = undefined; reply(200, { status: 'expired' }); }
      else {
        const event = (await invoke({ action: 'poll', key }))[0];
        if (['success', 'expired'].includes(event.status)) { key = undefined; image = undefined; }
        reply(200, { status: event.status });
      }
    } else if (request.url === '/status' || request.url === '/logout') {
      const action = request.url.slice(1);
      if (action === 'logout') { generation++; key = undefined; image = undefined; }
      const event = (await invoke({ action }))[0];
      reply(200, { status: event.loggedIn ? 'loggedIn' : 'anonymous' });
    } else reply(404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error && /^video_[a-z_]+$/.test(error.message) ? error.message : 'login_failed';
    reply(502, { error: message });
  } finally { busy = false; }
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('MOWO login experiment: ' + origin);
});
const timer = setTimeout(() => { abort.abort(); server.close(); }, 10 * 60 * 1000);
const close = () => { clearTimeout(timer); abort.abort(); server.close(); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
