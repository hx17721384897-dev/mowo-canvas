import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createServer, connect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';

const mode = process.argv[2] ?? 'dev'; assert.ok(['dev', 'start'].includes(mode));
const root = await mkdtemp(resolve('data/video-runtime/launch-' + mode + '-'));
let project = process.cwd();
if (mode === 'dev') {
  // The user's dev server may already own .next/dev. Copy source, never stop their server.
  project = join(root, 'fixture'); await mkdir(join(project, 'data'), { recursive: true });
  for (const directory of ['src', 'drizzle', 'scripts/video']) await cp(resolve(directory), join(project, directory), { recursive: true });
  for (const file of ['package.json', 'next.config.ts', 'tsconfig.json']) await copyFile(resolve(file), join(project, file));
  await symlink(resolve('data/video-runtime'), join(project, 'data/video-runtime'), 'junction');
  await symlink(resolve('node_modules'), join(project, 'node_modules'), 'junction');
}
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(accept => probe.close(accept));
const delay = ms => new Promise(accept => setTimeout(accept, ms));
function listening(port) { return new Promise(accept => { const socket = connect({ host: '127.0.0.1', port }); const finish = result => { socket.destroy(); accept(result); }; socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(500, () => finish(false)); }); }
let child, logs = '', servicePort;
async function stop() {
  if (child?.exitCode === null && child.pid) {
    const ended = once(child, 'close');
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await once(killer, 'exit'); await ended;
  }
  const deadline = Date.now() + 10000;
  while (await listening(port) || (servicePort && await listening(servicePort))) {
    if (Date.now() > deadline) throw new Error('Application left a listening process'); await delay(150);
  }
}
async function start() {
  child = spawn(process.execPath, [npm, 'run', mode, '--', '-p', String(port)], { cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOWO_DATA_ROOT: root, NEXT_TELEMETRY_DISABLED: '1' } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-3000); });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/video-downloads/storage`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const data = await response.json(); assert.ok(data.availableBytes > 0); assert.equal(data.versions.python, '3.14.10');
        servicePort = JSON.parse(await readFile(join(root, 'runtime/video-service.json'), 'utf8')).port;
        return;
      }
    } catch { /* wait for compilation */ }
    await delay(200);
  }
  throw new Error('Default npm entry failed: ' + logs);
}
try {
  await start();
  const created = (await (await fetch(`http://127.0.0.1:${port}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"launcher verification"}' })).json()).project;
  await stop();
  const sql = new Database(join(root, 'database/mowo.db'));
  sql.pragma('journal_mode = WAL'); sql.pragma('busy_timeout = 5000');
  const insert = sql.prepare('INSERT INTO video_download_tasks(id,project_id,source_url,bvid,part,title,format_ids_json,status,relative_path,created_at,updated_at) VALUES (?,?,?, ?,1,?, ?,?,?,0,0)');
  insert.run('queued', created.id, 'https://www.bilibili.com/video/BV1bv411T7et?p=1', 'BV1bv411T7et', 'queued fixture', '["1"]', 'queued', null);
  insert.run('missing', created.id, 'https://www.bilibili.com/video/BV1bv411T7et?p=1', 'BV1bv411T7et', 'missing fixture', '["1"]', 'ready', 'temp/video-downloads/missing/source.mp4');
  sql.close();
  await start();
  const tasks = (await (await fetch(`http://127.0.0.1:${port}/api/projects/${created.id}/video-downloads`)).json()).tasks;
  assert.equal(tasks.find(task => task.id === 'queued').status, 'interrupted');
  assert.equal(tasks.find(task => task.id === 'missing').errorCode, 'FILE_MISSING');
  assert.equal(tasks.find(task => task.id === 'missing').status, 'failed');
  console.log(`Default npm ${mode} passed: service ready, forced exit released both ports, restart persisted interrupted/missing records. Evidence: ${root}`);
} finally { await stop(); }
