import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, mkdir, copyFile, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/features/assets/server/schema.ts';
import { VideoTaskStore } from '../../src/features/video-downloads/server/task-store.ts';
import { invokeEngine } from './engine-client.mjs';
import { checkDownloadBrowser } from './check-download-browser.mjs';

// Fully local fixtures: no platform requests or production credentials.
const root = await mkdtemp(resolve('data/video-runtime/import-product-'));
const data = join(root, 'data'); await mkdir(join(data, 'database'), { recursive: true });
const sql = new Database(join(data, 'database/mowo.db'));
sql.pragma('journal_mode = WAL'); sql.pragma('foreign_keys = ON');
const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: 'drizzle' });
const store = new VideoTaskStore(db);
for (const projectId of ['project', 'other']) {
  db.insert(schema.projects).values({ id: projectId, name: '视频入库验收', createdAt: new Date(), updatedAt: new Date() }).run();
  sql.prepare('INSERT INTO canvas_documents(project_id,schema_version,nodes_json,edges_json,viewport_json,created_at,updated_at) VALUES (?,1,?,?,?,0,0)').run(projectId, '[]', '[]', '{"x":0,"y":0,"zoom":1}');
}
const ffmpeg = resolve('data/video-runtime/tools/ffmpeg.exe'), ffprobe = resolve('data/video-runtime/tools/ffprobe.exe');
const delay = ms => new Promise(accept => setTimeout(accept, ms));
async function hash(path) { const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest('hex'); }
async function fixture(name, options) {
  const task = store.create('project', { url: 'BV1bv411T7et', formatIds: ['fixture'], title: name });
  const directory = join(data, 'temp/video-downloads', task.id); await mkdir(directory, { recursive: true });
  const source = join(directory, 'source.mp4');
  const process = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '4', '-an', ...options, '-pix_fmt', 'yuv420p', '-threads', '1', source], { windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(process, 'exit'))[0], 0, 'local media fixture generation');
  const events = await invokeEngine({ action: 'probe', file: source, ffprobe });
  const execution = store.claim('project', task.id).executionId;
  store.applyEvent('project', task.id, execution, { v: 1, event: 'downloaded', file: 'source.mp4' });
  store.applyEvent('project', task.id, execution, events.find(event => event.event === 'probed'));
  return { id: task.id, source, hash: await hash(source) };
}
const compatible = await fixture('H264 silent fixture', ['-c:v', 'libx264', '-preset', 'ultrafast']);
const hevc = await fixture('HEVC fixture', ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1']);
const hdr = await fixture('HDR fixture', ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:transfer=smpte2084:colorprim=bt2020:colormatrix=bt2020nc']);
// Download normally creates covers before ready. Seed one through the same worker here.
const coverDirectory = join(data, 'cache/video-downloads', hevc.id); await mkdir(coverDirectory, { recursive: true });
await invokeEngine({ action: 'cover', file: hevc.source, target: join(coverDirectory, 'cover.jpg'), ffmpeg }, { managed: { root: join(root, 'fixture-control'), directory: coverDirectory } });
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(accept => probe.close(accept));
const base = `http://127.0.0.1:${port}`;
let logs = '', app;
function launch(dataRoot) {
  logs = '';
  app = spawn(process.execPath, [resolve('scripts/video/run-app.mjs'), 'start', '--video', '-p', String(port), '-H', '127.0.0.1'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOWO_DATA_ROOT: dataRoot, MOWO_APP_CONTROL_ROOT: join(root, 'control'), NEXT_TELEMETRY_DISABLED: '1' },
  });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-2500); });
}
async function stop() {
  if (app.exitCode === null) { const ended = once(app, 'close'); app.kill('SIGKILL'); await ended; }
  await delay(1500);
}
launch(data);
const path = '/api/projects/project/video-downloads';
async function api(url, method = 'GET', body, status = 200) {
  const response = await fetch(base + url, { method, headers: { origin: base, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}
async function waitFor(id, predicate) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { const { task } = await api(`${path}/${id}`); if (predicate(task)) return task; await delay(150); }
  throw new Error('Media task state did not arrive');
}
async function range(url, mime) {
  const response = await fetch(base + url, { headers: { origin: base, Range: 'bytes=0-31' } });
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 32); assert.equal(response.headers.get('content-type'), mime);
  const head = await fetch(base + url, { method: 'HEAD', headers: { origin: base } }); assert.equal(head.status, 200); assert.ok(Number(head.headers.get('content-length')) > 32);
  const invalid = await fetch(base + url, { headers: { origin: base, Range: 'bytes=999999999999-' } }); assert.equal(invalid.status, 416);
}
try {
  const deadline = Date.now() + 30000; let served = false;
  while (Date.now() < deadline && app.exitCode === null) {
    try { if ((await fetch(base + path, { signal: AbortSignal.timeout(1000) })).ok) { served = true; break; } } catch { /* startup */ }
    await delay(150);
  }
  assert.ok(served, logs);
  const storage = await api('/api/video-downloads/storage');
  assert.ok(storage.availableBytes > storage.reserveBytes); assert.equal(storage.versions.python, '3.14.10');
  const raw = (await api(`${path}/${compatible.id}`)).task;
  await api(`${path}/${compatible.id}/cleanup`, 'POST', undefined, 409);
  await range(raw.previewUrl, 'video/mp4');
  const [first, repeated] = await Promise.all([api(`${path}/${compatible.id}/import`, 'POST'), api(`${path}/${compatible.id}/import`, 'POST')]);
  assert.equal(first.assetId, repeated.assetId); assert.equal(first.task.status, 'completed');
  await range(`/api/assets/${first.assetId}/content`, 'video/mp4');
  const ready = await waitFor(hevc.id, task => task.previewStatus === 'ready');
  await range(ready.previewUrl, 'video/mp4');
  const failed = await waitFor(hdr.id, task => task.previewStatus === 'failed');
  assert.equal(failed.status, 'ready'); assert.equal(failed.errorCode, 'HDR_PREVIEW_UNSUPPORTED');
  const importedHdr = await api(`${path}/${hdr.id}/import`, 'POST'); assert.equal(importedHdr.task.status, 'completed');
  const noPreview = await fetch(`${base}/api/assets/${importedHdr.assetId}/preview`, { headers: { origin: base } }); assert.equal(noPreview.status, 409);
  await api(`${path}/${hdr.id}/preview`, 'POST'); await waitFor(hdr.id, task => task.previewStatus === 'failed');
  if (process.argv.includes('--browser')) await checkDownloadBrowser(base, 'project', root, false, 'HEVC fixture');
  const imported = await api(`${path}/${hevc.id}/import`, 'POST');
  await range(`/api/assets/${imported.assetId}/preview`, 'video/mp4');
  const cover = await fetch(`${base}/api/assets/${imported.assetId}/cover`, { headers: { origin: base } }); assert.equal(cover.status, 200); assert.equal(cover.headers.get('content-type'), 'image/jpeg');
  const assetRow = db.select().from(schema.assets).all().find(asset => asset.id === imported.assetId);
  assert.equal(await hash(join(data, assetRow.relativePath)), hevc.hash);
  assert.equal(await hash(hevc.source), hevc.hash);
  // Stable asset cache and original remain usable after the temporary source is removed.
  if (process.argv.includes('--delivery')) {
    const cleaned = await api(`${path}/${hevc.id}/cleanup`, 'POST'); assert.ok(cleaned.cleanedDirectories > 0);
    assert.equal((await api(`${path}/${hevc.id}/cleanup`, 'POST')).cleanedDirectories, 0);
    assert.equal(cleaned.task.previewUrl, `/api/assets/${imported.assetId}/preview`);
  } else await unlink(hevc.source);
  await range(`/api/assets/${imported.assetId}/preview`, 'video/mp4'); await range(`/api/assets/${imported.assetId}/content`, 'video/mp4');
  assert.equal((await api(`${path}/${hevc.id}/import`, 'POST')).assetId, imported.assetId);
  assert.equal((await api('/api/projects/project/assets')).assets.length, 3);
  const copied = store.create('other', { url: 'BV1xx411c7mu', formatIds: ['fixture'], title: 'same original other source' });
  const execution = store.claim('other', copied.id).executionId;
  const destination = join(data, 'temp/video-downloads', copied.id); await mkdir(destination, { recursive: true }); await copyFile(join(data, assetRow.relativePath), join(destination, 'source.mp4'));
  store.applyEvent('other', copied.id, execution, { v: 1, event: 'downloaded', file: 'source.mp4' });
  const originalMedia = JSON.parse(assetRow.videoMetadataJson); store.applyEvent('other', copied.id, execution, { v: 1, event: 'probed', ...originalMedia });
  const shared = await api(`/api/projects/other/video-downloads/${copied.id}/import`, 'POST'); assert.equal(shared.assetId, imported.assetId);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM assets').get().n, 3);
  assert.ok((await stat(join(data, assetRow.relativePath))).size > 0);
  if (process.argv.includes('--delivery')) {
    await stop(); sql.pragma('wal_checkpoint(TRUNCATE)'); sql.close();
    const restored = join(root, 'restored-data'); await mkdir(restored);
    for (const directory of ['database', 'storage']) await cp(join(data, directory), join(restored, directory), { recursive: true });
    await copyFile(join(data, 'data-version.json'), join(restored, 'data-version.json'));
    const restoredSql = new Database(join(restored, 'database/mowo.db'));
    restoredSql.prepare(`INSERT INTO video_download_tasks(id,project_id,source_url,bvid,part,title,format_ids_json,status,relative_path,created_at,updated_at) VALUES ('restore-missing','project',?,'BV1bv411T7et',1,'missing temp','["1"]','ready','temp/video-downloads/restore-missing/source.mp4',0,0)`).run('https://www.bilibili.com/video/BV1bv411T7et?p=1');
    restoredSql.close(); launch(restored);
    const deadline = Date.now() + 30000; let served = false;
    while (Date.now() < deadline && app.exitCode === null) {
      try { if ((await fetch(base + path, { signal: AbortSignal.timeout(1000) })).ok) { served = true; break; } } catch { /* startup */ }
      await delay(150);
    }
    assert.ok(served, logs);
    assert.equal((await api(`${path}/restore-missing`)).task.errorCode, 'FILE_MISSING');
    assert.equal((await api(`${path}/${hevc.id}/import`, 'POST')).assetId, imported.assetId);
    assert.equal(await hash(join(restored, assetRow.relativePath)), hevc.hash);
    await api(`${path}/${hevc.id}/preview`, 'POST');
    await waitFor(hevc.id, task => task.previewStatus === 'ready');
    await range(`/api/assets/${imported.assetId}/preview`, 'video/mp4');
    await range(`/api/assets/${imported.assetId}/content`, 'video/mp4');
    console.log('D restore passed: stopped copy of database/storage/version, missing temp explicitly failed, formal asset retained, omitted preview cache rebuilt.');
  }
  console.log('C media import passed: silent original, concurrent idempotence, HEVC preview, HDR failure with original import, ranges/HEAD, cover, cross-project dedupe, temp cleanup independence. Evidence: ' + root);
} finally {
  if (sql.open) sql.close();
  await stop();
}
