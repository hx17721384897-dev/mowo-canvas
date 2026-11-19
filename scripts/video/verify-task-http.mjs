import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { checkDownloadBrowser } from './check-download-browser.mjs';
import Database from 'better-sqlite3';

// Exercise the current production build against an isolated database, never user data.
const root = await mkdtemp(resolve('data/video-runtime/task-http-'));
const live = process.argv.includes('--live');
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(accept => probe.close(accept));
const base = `http://127.0.0.1:${port}`;
function startApp() {
const child = spawn(process.execPath, [resolve('scripts/video/run-app.mjs'), 'start', '--video',
  '-p', String(port), '-H', '127.0.0.1'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, MOWO_DATA_ROOT: join(root, 'data'),
    MOWO_APP_CONTROL_ROOT: join(root, 'control'), NEXT_TELEMETRY_DISABLED: '1' },
});
let logs = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-3000); });
return { child, logs: () => logs };
}
let app = startApp(), child = app.child;
async function stopApp() {
  if (child.exitCode === null) { const ended = once(child, 'close'); child.kill('SIGKILL'); await ended; }
  await new Promise(accept => setTimeout(accept, 1500));
}
async function request(path, method = 'GET', body, status = 200, origin = base) {
  const response = await fetch(base + path, { method, headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const result = response.status === 204 ? {} : await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  if (path.includes('/video-downloads')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return result;
}
try {
  let served = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && child.exitCode === null) {
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { served = true; break; } } catch { /* startup */ }
    await new Promise(accept => setTimeout(accept, 200));
  }
  assert.ok(served, `production server did not start: ${app.logs()}`);
  const { project } = await request('/api/projects', 'POST', { name: 'video API isolated test' }, 201);
  const { project: other } = await request('/api/projects', 'POST', { name: 'other project' }, 201);
  const path = `/api/projects/${project.id}/video-downloads`;
  assert.deepEqual((await request(path)).tasks, []);
  assert.equal((await request(path, 'POST', { resolveId: '00000000-0000-4000-8000-000000000000', choiceId: '30080' }, 409)).code, 'RESOLVE_EXPIRED');
  assert.equal((await request(path, 'POST', { url: 'https://example.com', formatIds: ['1'] }, 400)).code, 'INVALID_INPUT');
  assert.equal((await request(path, 'GET', undefined, 403, 'https://example.com')).code, 'LOCAL_ONLY');
  assert.equal((await request(path, 'POST', { title: 'x'.repeat(17000) }, 413)).code, 'BODY_TOO_LARGE');
  if (process.argv.includes('--browser')) await checkDownloadBrowser(base, project.id, root, live);
  if (live) {
    if (!process.argv.includes('--browser')) {
      const { video } = await request(`${path}/resolve`, 'POST', { url: 'BV1bv411T7et' });
      await request(path, 'POST', { resolveId: video.resolveId, choiceId: video.choices[0].id }, 201);
    }
    const task = (await request(path)).tasks[0]; assert.ok(task);
    assert.equal((await request(`/api/projects/${other.id}/video-downloads/${task.id}`, 'GET', undefined, 404)).code, 'TASK_NOT_FOUND');
    assert.equal((await request(`/api/projects/${project.id}`, 'DELETE', undefined, 409)).error.includes('下载任务'), true);
    assert.equal((await request('/api/projects', 'DELETE', { ids: [other.id, project.id] }, 409)).error.includes('下载任务'), true);
    assert.ok((await request('/api/projects')).projects.some(p => p.id === other.id));
    const current = (await request(`${path}/${task.id}`)).task;
    if (current.status !== 'ready') {
      assert.equal((await request(`${path}/${task.id}`, 'DELETE')).task.status, 'cancelled');
      assert.equal((await request(`${path}/${task.id}/retry`, 'POST')).task.status, 'queued');
      console.log('Active cancellation confirmed stopped; manual retry queued.');
    }
    const deadline = Date.now() + 240000;
    let result;
    while (Date.now() < deadline) {
      result = (await request(`${path}/${task.id}`)).task;
      if (['ready', 'failed', 'interrupted', 'cancelled'].includes(result.status)) break;
      await new Promise(accept => setTimeout(accept, 500));
    }
    assert.equal(result.status, 'ready', JSON.stringify(result));
    assert.ok(result.media.duration > 0); assert.equal(result.assetId, null);
    const summary = JSON.stringify(result);
    for (const hidden of ['executionId', 'relativePath', 'cookie', 'credentials']) assert.ok(!summary.includes(hidden));
    const auth = await request('/api/video-downloads/auth', 'POST', { action: 'status' });
    assert.equal(auth.status, 'anonymous');
    const qr = await request('/api/video-downloads/auth', 'POST', { action: 'generate' });
    assert.equal(qr.status, 'waiting'); assert.ok(qr.image.startsWith('iVBOR'));
    assert.ok(!JSON.stringify(qr).includes('key'));
    await request('/api/video-downloads/auth', 'POST', { action: 'logout' });
    if (process.argv.includes('--restart')) {
      await stopApp();
      // Seed a queued record while stopped, then prove startup never executes it automatically.
      const database = new Database(join(root, 'data/database/mowo.db'));
      database.prepare(`INSERT INTO video_download_tasks(id,project_id,source_url,bvid,part,title,format_ids_json,status,created_at,updated_at) VALUES ('restart-task',?,?,?,?,?,?,'queued',0,0)`)
        .run(project.id, result.sourceUrl, result.bvid, result.part, 'restart record', JSON.stringify(result.formatIds));
      database.close();
      app = startApp(); child = app.child;
      const deadline = Date.now() + 30000;
      let recovered;
      while (Date.now() < deadline && child.exitCode === null) {
        try { recovered = await request(`${path}/restart-task`); break; } catch { await new Promise(accept => setTimeout(accept, 200)); }
      }
      assert.equal(recovered?.task.status, 'interrupted', app.logs());
      assert.equal((await request(`${path}/${task.id}`)).task.status, 'ready');
      await new Promise(accept => setTimeout(accept, 1000));
      assert.equal((await request(`${path}/restart-task`)).task.status, 'interrupted');
      await request(`${path}/restart-task`, 'DELETE');
      console.log('Restart passed: records persist, queued becomes interrupted without auto-execution, verified original stays ready.');
    }
    if (process.argv.includes('--import')) {
      const imported = await request(`${path}/${task.id}/import`, 'POST');
      assert.equal(imported.task.status, 'completed'); assert.equal(imported.asset.id, imported.assetId);
      assert.equal((await request(`${path}/${task.id}/import`, 'POST')).assetId, imported.assetId);
      const media = await fetch(`${base}/api/assets/${imported.assetId}/preview`, { headers: { origin: base, range: 'bytes=0-31' } });
      assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 32);
      console.log('User sample confirmed in asset library: original import, repeated import deduplication, stable video preview Range.');
    } else assert.equal((await request(`${path}/${task.id}/discard`, 'POST')).task.status, 'cancelled');
    await request(`/api/projects/${project.id}`, 'DELETE', undefined, 204);
    console.log('Live product download passed: real resolve/download/probe, project scope, deletion guards, cancel/retry when active, ' + (process.argv.includes('--import') ? 'confirmed import.' : 'explicit discard.'));
  }
  console.log('Production video HTTP passed: isolated root, expired resolve, origin/body/input guards. Evidence: ' + root);
} finally {
  await stopApp();
}
