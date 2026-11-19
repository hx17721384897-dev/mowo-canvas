import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer, connect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = await mkdtemp(resolve('data/video-runtime/app-lifecycle-'));
const fixture = join(root, 'fixture');
await mkdir(join(fixture, 'app'), { recursive: true });
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'mowo-lifecycle-fixture', private: true,
  dependencies: { next: '16.4.3', react: '19.3.0', 'react-dom': '19.3.0' } }));
await writeFile(join(fixture, 'app/layout.jsx'), 'export default function Layout({children}){return <html><body>{children}</body></html>}');
await writeFile(join(fixture, 'app/page.jsx'), 'export default function Page(){return <main>MOWO lifecycle fixture</main>}');
const delay = ms => new Promise(accept => setTimeout(accept, ms));
async function freePort() {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(accept => probe.close(accept)); return port;
}
async function open(port) {
  return new Promise(accept => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); accept(value); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(300, () => done(false));
  });
}
async function exercise(mode, project, port) {
  const child = spawn(process.execPath, [resolve('scripts/video/run-app.mjs'), mode, '--project', project,
    '-p', String(port), '-H', '127.0.0.1', ...(mode === 'dev' ? ['--webpack'] : [])], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOWO_DATA_ROOT: join(root, 'data'), MOWO_APP_CONTROL_ROOT: join(root, 'control'), NEXT_TELEMETRY_DISABLED: '1' },
  });
  let logs = '';
  child.stdout.on('data', data => { logs = (logs + data.toString()).slice(-3000); });
  child.stderr.on('data', data => { logs = (logs + data.toString()).slice(-3000); });
  try {
    const deadline = Date.now() + 90000;
    let served = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { served = true; break; }
      } catch { /* Wait for the server or compilation. */ }
      await delay(200);
    }
    assert.ok(served, `${mode} must serve HTTP 200: ${logs}`);
  } finally {
    const ended = once(child, 'close');
    if (child.exitCode === null) child.kill('SIGKILL');
    await ended;
  }
  const deadline = Date.now() + 10000;
  while (await open(port)) {
    if (Date.now() > deadline) throw new Error(`${mode} left a listening descendant`);
    await delay(100);
  }
  console.log(`${mode}: HTTP 200, forced launcher exit stopped descendants and released port ${port}`);
}
const port = await freePort();
await exercise('dev', fixture, port);
await exercise('dev', fixture, port); // Same port/root verifies slot reacquisition after an abrupt owner exit.
await access(resolve('.next/BUILD_ID'));
await exercise('start', process.cwd(), port); // Existing application build, isolated database; no rebuild of user changes.
console.log('Application lifecycle passed; dev used an isolated fixture, start used the existing MOWO build.');
