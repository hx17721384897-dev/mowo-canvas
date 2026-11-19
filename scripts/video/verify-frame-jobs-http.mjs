import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { checkFrameNodeBrowser } from './check-frame-node-browser.mjs';

const root = await mkdtemp(resolve('data/video-runtime/frame-jobs-http-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(accept => probe.close(accept));
const base = `http://127.0.0.1:${port}`, data = join(root, 'data');
const delay = ms => new Promise(accept => setTimeout(accept, ms));
let app, logs = '';
function start() {
  app = spawn(process.execPath, [resolve('scripts/video/run-app.mjs'), process.argv.includes('--dev') ? 'dev' : 'start', '--video',
    ...(process.argv.includes('--dev') ? ['--webpack'] : []), '-p', String(port), '-H', '127.0.0.1'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOWO_DATA_ROOT: data,
      MOWO_APP_CONTROL_ROOT: join(root, 'control'), MOWO_NEXT_DIST_DIR: '.next-video-frame-jobs-test', NEXT_TELEMETRY_DISABLED: '1' },
  });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
}
async function stop() {
  if (app && app.exitCode === null) { const closed = once(app, 'close'); app.kill('SIGKILL'); await closed; }
  // The existing guardian observes parent death and reaps both owned process trees.
  await delay(1800);
}
async function ready() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && app.exitCode === null) {
    try { if ((await fetch(base + '/api/projects', { signal: AbortSignal.timeout(10000) })).ok) return; } catch { /* startup */ }
    await delay(250);
  }
  throw new Error(`Isolated application did not start: ${logs}`);
}
async function request(path, method = 'GET', body, status = 200, origin = base) {
  const response = await fetch(base + path, { method, headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const result = response.status === 204 ? {} : await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
async function waitJob(path) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const { job } = await request(path);
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    await delay(150);
  }
  throw new Error('Job did not finish');
}
function counts() {
  const db = new Database(join(data, 'database/mowo.db'), { readonly: true });
  try { return Object.fromEntries(['video_frame_jobs', 'frame_extraction_tasks', 'frame_extraction_sources', 'asset_collections']
    .map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n])); }
  finally { db.close(); }
}
try {
  const video = join(root, 'source.mp4'), gif = join(root, 'source.gif');
  const exec = promisify(execFile), ffmpeg = resolve('data/video-runtime/tools/ffmpeg.exe');
  await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=48:d=0.25', '-c:v', 'libx264', video], { windowsHide: true });
  await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=10:d=0.3', gif], { windowsHide: true });
  start(); await ready();
  console.log('Isolated application ready');
  const { project } = await request('/api/projects', 'POST', { name: 'frame jobs isolated' }, 201);
  const { project: other } = await request('/api/projects', 'POST', { name: 'other' }, 201);
  const upload = await fetch(`${base}/api/projects/${project.id}/videos?name=source.mp4`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await readFile(video), signal: AbortSignal.timeout(90000),
  });
  const uploaded = await upload.json(); assert.equal(upload.status, 201, JSON.stringify(uploaded));
  const path = `/api/projects/${project.id}/video-frame-jobs`;
  const body = { requestId: randomUUID(), nodeId: 'video-node', mode: 'analyze', inputs: [{ assetId: uploaded.asset.id }],
    settings: { restore: true, targetFps: 24, every: 1, keep: 1 } };
  assert.equal((await request(path, 'POST', body, 403, 'https://example.com')).code, 'LOCAL_ONLY');
  await request(path, 'POST', { ...body, extra: 'invalid' }, 400);
  await request(`/api/projects/${other.id}/video-frame-jobs`, 'POST', body, 400);
  const duplicates = await Promise.all([request(path, 'POST', body, 202), request(path, 'POST', body, 202)]);
  assert.equal(duplicates[0].job.id, duplicates[1].job.id);
  const analysis = await waitJob(`${path}/${duplicates[0].job.id}`);
  assert.equal(analysis.status, 'ready', JSON.stringify(analysis));
  console.log('Analysis and duplicate request checks passed');
  assert.equal(analysis.inputs[0].analysis.estimatedFrameCount, 6);
  assert.equal(counts().frame_extraction_tasks, 0, 'analysis must not create a frame draft');
  const extractBody = { ...body, requestId: randomUUID(), mode: 'extract' };
  const [one, two] = await Promise.all([request(path, 'POST', extractBody, 202), request(path, 'POST', extractBody, 202)]);
  assert.equal(one.job.id, two.job.id);
  const extracted = await waitJob(`${path}/${one.job.id}`);
  assert.equal(extracted.status, 'ready', JSON.stringify(extracted));
  console.log('Extraction finished');
  await request(`/api/projects/${other.id}/video-frame-jobs/${one.job.id}`, 'GET', undefined, 404);
  const taskPath = `/api/frame-extraction/tasks/${extracted.resultTaskId}`;
  const { task } = await request(taskPath), source = task.sources[0];
  assert.equal(source.sourceKind, 'video'); assert.equal(source.frames.length, 6);
  assert.equal(new Set(source.frames.map(frame => frame.id)).size, 6);
  assert.ok(source.frames.every(frame => frame.sourceMapping));
  const reversed = source.frames.map(frame => frame.id).reverse();
  const edited = await request(`${taskPath}/sources/${source.id}`, 'PATCH', { orderedFrameIds: reversed });
  assert.deepEqual(edited.task.sources[0].frames.map(frame => frame.id), reversed);
  const stitch = await request('/api/frame-extraction/stitch', 'POST', { projectId: project.id, taskId: task.id,
    sequences: [{ sourceId: source.id, frameIds: reversed, settings: { columns: 3, gap: 0, margin: 0, background: 'transparent' } }] });
  assert.equal(stitch.outputs.length, 1); assert.equal(stitch.failures.length, 0);
  const saves = await Promise.all([request(`${taskPath}/sources/${source.id}/save`, 'POST'), request(`${taskPath}/sources/${source.id}/save`, 'POST')]);
  assert.equal(saves[0].sequence.collectionId, saves[1].sequence.collectionId);
  assert.equal(saves[0].sequence.assets.length, 6);
  assert.equal(counts().frame_extraction_tasks, 1); assert.equal(counts().asset_collections, 1);
  assert.equal((await request(`${path}/${extracted.id}`)).job.resultTaskId, task.id);
  const form = new FormData(); form.append('files', new File([await readFile(gif)], 'source.gif', { type: 'image/gif' }));
  const images = await fetch(`${base}/api/projects/${project.id}/assets`, { method: 'POST', body: form });
  const imported = await images.json(); assert.equal(images.status, 201, JSON.stringify(imported));
  const animated = await request('/api/frame-extraction/tasks', 'POST', { projectId: project.id, assetIds: [imported.assets[0].id] }, 201);
  assert.equal(animated.task.sources[0].sourceKind, 'animated');
  assert.ok(animated.task.sources[0].frames.length > 1);
  const gifSaved = await request(`/api/frame-extraction/tasks/${animated.task.id}/sources/${animated.task.sources[0].id}/save`, 'POST');
  assert.ok(gifSaved.sequence.collectionId);
  if (process.argv.includes('--browser')) await checkFrameNodeBrowser(base, project.id, uploaded.asset, root);
  const before = counts();
  if (!process.argv.includes('--dev')) { await stop(); start(); await ready(); }
  assert.equal((await request(`${path}/${extracted.id}`)).job.status, 'ready');
  assert.deepEqual(counts(), before, 'restart must not create a second draft or sequence');
  assert.equal((await request(`${taskPath}/sources/${source.id}/save`, 'POST')).sequence.collectionId, saves[0].sequence.collectionId);
  const listed = await request(path + '?nodeId=video-node'); assert.equal(listed.jobs.length, 2);
  console.log(JSON.stringify({ passed: true, analysisDrafts: 0, videoDrafts: 1, savedVideoSequences: 1,
    gifCompatibility: true, repeatedCreate: true, repeatedSave: true, sharedEditing: true, sharedStitch: true, restart: !process.argv.includes('--dev') }));
} catch (error) {
  console.error(logs); throw error;
} finally {
  await stop();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
