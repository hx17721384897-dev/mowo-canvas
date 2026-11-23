import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { copyFile, mkdtemp, open, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { checkEditorBrowser } from './check-editor-browser.mjs';

const fixtureParent = await realpath(resolve('data/video-runtime'));
const root = await mkdtemp(join(fixtureParent, 'editor-entry-'));
const keepFixture = process.argv.includes('--keep-fixture');
let app;
let logs = '';
const delay = ms => new Promise(accept => setTimeout(accept, ms));
try {
  const fixture = join(root, 'long.mp4');
  const hevcFixture = join(root, 'hevc.mp4');
  const ffmpeg = resolve('data/video-runtime/tools/ffmpeg.exe');
  const generator = spawn(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=1',
    '-t', '301', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', fixture],
  { windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(generator, 'exit'))[0], 0, 'generate local 301-second fixture');
  const hevcGenerator = spawn(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
    '-t', '3', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1',
    '-pix_fmt', 'yuv420p', '-an', hevcFixture], { windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(hevcGenerator, 'exit'))[0], 0, 'generate local HEVC fixture');
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(accept => portProbe.close(accept));
  const base = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '-H', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOWO_DATA_ROOT: join(root, 'data'), MOWO_NEXT_DIST_DIR: process.env.MOWO_NEXT_DIST_DIR || '.next-editor-test' } });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-3000); });
  let ready = false;
  for (let i = 0; i < 120 && app.exitCode === null; i++) {
    try { ready = (await fetch(base + '/api/projects', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, logs);
  const created = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Video editor smoke' }) });
  const creation = await created.json();
  assert.equal(created.status, 201, JSON.stringify(creation));
  const { project } = creation;
  const bytes = await readFile(fixture);
  const imported = await fetch(`${base}/api/projects/${project.id}/videos?name=long.mp4`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
  });
  const result = await imported.json();
  assert.equal(imported.status, 201, JSON.stringify(result));
  const { asset } = result;
  let compositionOutputId;
  assert.ok(asset.duration > 300 && asset.duration < 302);
  assert.equal(asset.size, (await stat(fixture)).size);
  const page = await fetch(`${base}/video-editor/${project.id}/${asset.id}`);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('观察页'));
  const range = await fetch(base + asset.previewUrl, { headers: { Range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  const indexUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/index`;
  const started = await fetch(indexUrl, { method: 'POST' });
  assert.equal(started.status, 202);
  let index;
  for (let attempt = 0; attempt < 120; attempt++) {
    index = await (await fetch(indexUrl)).json();
    if (index.status === 'ready' || index.status === 'failed') break;
    await delay(250);
  }
  assert.equal(index?.status, 'ready', JSON.stringify(index));
  assert.equal(index.metadata.frameCount, 301);
  if (process.argv.includes('--cutting-playback-modes')) {
    const cuttingUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/cutting-project`;
    const saved = await fetch(cuttingUrl, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, clips: [
        { id: randomUUID(), sourceAssetId: asset.id, inFrame: 0, outFrame: 3 },
        { id: randomUUID(), sourceAssetId: asset.id, inFrame: 3, outFrame: 5 },
      ] }) });
    assert.equal(saved.status, 200, await saved.text());
  }
  if (process.argv.includes('--cutting-step-five')) {
    const cuttingUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/cutting-project`;
    const clips = [
      { id: randomUUID(), sourceAssetId: asset.id, inFrame: 150, outFrame: 301 },
      { id: randomUUID(), sourceAssetId: asset.id, inFrame: 0, outFrame: 150 },
    ];
    const savedProject = await (await fetch(cuttingUrl, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clips, expectedRevision: 0 }) })).json();
    assert.equal(savedProject.revision, 1);
    assert.equal((await fetch(`${cuttingUrl}/export?revision=0`)).status, 409, 'stale download must be rejected');
    assert.equal((await fetch(`${cuttingUrl}/output`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0 }) })).status, 409, 'stale save must be rejected');
    const exportResponse = await fetch(`${cuttingUrl}/export?revision=1`);
    if (exportResponse.status !== 200) throw new Error(`Composition download failed: ${exportResponse.status} ${await exportResponse.text()}`);
    assert.equal(exportResponse.headers.get('content-type'), 'video/mp4');
    const exported = Buffer.from(await exportResponse.arrayBuffer());
    assert.ok(exported.length > 1000);
    const beforeOutput = new Database(join(root, 'data', 'database', 'mowo.db'), { readonly: true });
    assert.equal(beforeOutput.prepare('SELECT count(*) AS count FROM video_cutting_outputs WHERE project_id=?').get(project.id).count, 0,
      'download must not create a formal output asset');
    beforeOutput.close();
    const outputUrl = `${cuttingUrl}/output`;
    const firstOutput = await (await fetch(outputUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }) })).json();
    assert.equal(firstOutput.asset?.type, 'video', JSON.stringify(firstOutput));
    assert.equal(firstOutput.asset?.sourceType, 'video-cutting');
    compositionOutputId = firstOutput.asset.id;
    const secondOutput = await (await fetch(outputUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }) })).json();
    assert.equal(secondOutput.asset?.id, firstOutput.asset.id, 'repeated save must reuse one output');
    const outputDb = new Database(join(root, 'data', 'database', 'mowo.db'), { readonly: true });
    assert.equal(outputDb.prepare('SELECT count(*) AS count FROM video_cutting_outputs WHERE project_id=? AND source_asset_id=?')
      .get(project.id, asset.id).count, 1);
    assert.equal(outputDb.prepare('SELECT count(*) AS count FROM video_clip_drafts WHERE project_id=? AND source_asset_id=?')
      .get(project.id, asset.id).count, 0, 'output actions must not create selection drafts');
    const nodes = JSON.parse(outputDb.prepare('SELECT nodes_json FROM canvas_documents WHERE project_id=?').get(project.id).nodes_json);
    assert.equal(nodes.filter(node => node.data?.assetId === firstOutput.asset.id).length, 1,
      'repeated save must place exactly one output video card');
    outputDb.close();
    console.log('Composition output passed: MP4 download, independent formal asset, idempotent save, no duplicate drafts.');
  }
  if (process.argv.includes('--cutting-step-four')) {
    const testDb = new Database(join(root, 'data', 'database', 'mowo.db'));
    const source = testDb.prepare('SELECT content_hash FROM assets WHERE id=?').get(asset.id);
    const now = Date.now();
    testDb.prepare(`INSERT INTO video_shot_analyses
      (project_id, source_asset_id, source_hash, model_hash, status, progress_frames, frame_count, cuts_json, edit_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ready', 301, 301, ?, 0, ?, ?)`).run(project.id, asset.id, source.content_hash,
      'af5bc7dcbc517613d0d7fb39ee97add80e52a05d8de4717652e500a5bf573810',
      JSON.stringify([{ frame: 100, score: 1 }, { frame: 200, score: 1 }]), now, now);
    testDb.close();
  }
  if (process.argv.includes('--shots')) {
    const shotUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/shots`;
    const before = await (await fetch(shotUrl)).json();
    assert.equal(before.status, 'idle', 'opening the editor must not start shot detection');
    await delay(500);
    assert.equal((await (await fetch(shotUrl)).json()).status, 'idle', 'status polling must be read-only');
    const startResponses = await Promise.all([fetch(shotUrl, { method: 'POST' }), fetch(shotUrl, { method: 'POST' })]);
    assert.ok(startResponses.every(response => response.status === 202));
    const draftDuringAnalysisUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/draft`;
    const manualDraft = await fetch(draftDuringAnalysisUrl, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startFrame: 10, endFrame: 20, startSeconds: 10, endSeconds: 20, name: '检测时手动选段' }) });
    assert.equal(manualDraft.status, 200, 'manual clip draft must stay usable while detection runs');
    assert.equal((await fetch(draftDuringAnalysisUrl, { method: 'DELETE' })).status, 200);
    let shots;
    for (let attempt = 0; attempt < 180; attempt++) {
      shots = await (await fetch(shotUrl)).json();
      if (shots.status === 'ready' || shots.status === 'failed') break;
      await delay(500);
    }
    assert.equal(shots?.status, 'ready', JSON.stringify(shots));
    assert.equal(shots.frameCount, 301);
    assert.ok(Array.isArray(shots.cuts));
    const repeatedStart = await (await fetch(shotUrl, { method: 'POST' })).json();
    assert.equal(repeatedStart.status, 'ready', 'repeated start must reuse the completed analysis');
    console.log(`Manual shot detection passed: idle before click, ${shots.cuts.length} cuts after click.`);
  }
  const located = await (await fetch(`${indexUrl}?at=150.2`)).json();
  assert.equal(located.frame.ordinal, 150);
  for (const ordinal of [0, 150, 300]) {
    const frame = await fetch(`${base}/api/projects/${project.id}/video-editor/${asset.id}/frames/${ordinal}`);
    assert.equal(frame.status, 200, await frame.text());
    assert.equal(frame.headers.get('x-source-frame'), String(ordinal));
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  }
  const clipUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/clips`;
  const warmStart = performance.now();
  const warmFrame = await fetch(`${base}/api/projects/${project.id}/video-editor/${asset.id}/frames/150`);
  assert.equal(warmFrame.status, 200);
  await warmFrame.arrayBuffer();
  console.log(`Cached source frame HTTP: ${Math.round(performance.now() - warmStart)} ms`);
  const intentId = randomUUID();
  const clipRequest = { intentId, startFrame: 10, endFrame: 20 };
  const saved = await (await fetch(clipUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(clipRequest) })).json();
  assert.equal(saved.clip?.clip?.sourceAssetId, asset.id, JSON.stringify(saved));
  assert.equal(saved.clip.clip.startFrame, 10);
  assert.equal(saved.clip.clip.endFrame, 20);
  assert.equal(saved.clip.name, 'long · 片段 01');
  const repeated = await (await fetch(clipUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(clipRequest) })).json();
  assert.equal(repeated.clip?.id, saved.clip.id);
  const draftUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/draft`;
  const draft = { startFrame: 5, endFrame: 11, startSeconds: 5, endSeconds: 11, name: '草稿' };
  assert.equal((await fetch(draftUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })).status, 200);
  const second = await (await fetch(clipUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intentId: randomUUID(), startFrame: 21, endFrame: 30 }) })).json();
  assert.equal(second.clip?.name, 'long · 片段 02');
  assert.equal((await (await fetch(draftUrl)).json()).draft, null, 'formal clip commit must clear the draft atomically');
  assert.equal((await (await fetch(clipUrl)).json()).clips.length, 2);
  const draftWrites = await Promise.all(Array.from({ length: 3 }, () => fetch(draftUrl, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
  })));
  assert.ok(draftWrites.every(response => response.status === 200));
  const inspector = new Database(join(root, 'data', 'database', 'mowo.db'), { readonly: true });
  assert.equal(inspector.prepare('SELECT count(*) AS count FROM video_clip_drafts WHERE project_id=? AND source_asset_id=?')
    .get(project.id, asset.id).count, 1, 'repeated draft saves must upsert one record');
  inspector.close();
  assert.equal((await (await fetch(draftUrl)).json()).draft.name, '草稿');
  assert.equal((await fetch(draftUrl, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(draftUrl)).json()).draft, null);
  const reopened = await fetch(`${base}/video-editor/${project.id}/${asset.id}?clip=${saved.clip.id}`);
  assert.equal(reopened.status, 200);
  const hevcImported = await fetch(`${base}/api/projects/${project.id}/videos?name=hevc.mp4`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await readFile(hevcFixture),
  });
  const hevc = await hevcImported.json();
  assert.equal(hevcImported.status, 201, JSON.stringify(hevc));
  assert.ok(hevc.asset.previewUrl.endsWith('/preview'));
  const previewStateUrl = `${base}/api/projects/${project.id}/video-editor/${hevc.asset.id}/preview-state`;
  await fetch(previewStateUrl, { method: 'POST' });
  let previewState;
  for (let attempt = 0; attempt < 120; attempt++) {
    previewState = await (await fetch(previewStateUrl)).json();
    if (previewState.status === 'ready' || previewState.status === 'failed') break;
    await delay(500);
  }
  assert.equal(previewState?.status, 'ready', JSON.stringify(previewState));
  const previewRange = await fetch(base + hevc.asset.previewUrl, { headers: { Range: 'bytes=0-31' } });
  assert.equal(previewRange.status, 206);
  if (process.argv.includes('--large')) {
    const large = join(root, 'large.mp4');
    await copyFile(fixture, large);
    const file = await open(large, 'r+');
    const originalSize = (await file.stat()).size;
    const targetSize = 500 * 1024 * 1024 + 1024;
    const freeSize = targetSize - originalSize;
    const header = Buffer.alloc(8);
    header.writeUInt32BE(freeSize); header.write('free', 4);
    await file.write(header, 0, header.length, originalSize);
    await file.truncate(targetSize);
    await file.close();
    if (process.argv.includes('--cancel')) {
      const controller = new AbortController();
      const stream = createReadStream(large);
      let streamed = 0;
      stream.on('data', chunk => { streamed += chunk.length; if (streamed >= 4 * 1024 * 1024) controller.abort(); });
      try {
        const response = await fetch(`${base}/api/projects/${project.id}/videos?name=cancelled.mp4`, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': String(targetSize) },
          body: stream, duplex: 'half', signal: controller.signal,
        });
        assert.notEqual(response.status, 201, 'cancelled upload must not commit');
      } catch (error) {
        assert.ok(controller.signal.aborted, `unexpected upload failure: ${error}`);
      }
      let leftovers = [];
      for (let retry = 0; retry < 40; retry++) {
        leftovers = await readdir(join(root, 'data', 'temp', 'imports'));
        if (leftovers.length === 0) break;
        await delay(250);
      }
      assert.deepEqual(leftovers, [], 'cancelled upload temporary file must be removed');
      console.log('Cancelled large upload passed: no formal asset or temporary import file.');
    }
    const largeResponse = await fetch(`${base}/api/projects/${project.id}/videos?name=large.mp4`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': String(targetSize) },
      body: createReadStream(large), duplex: 'half', signal: AbortSignal.timeout(180000),
    });
    const largeResult = await largeResponse.json();
    assert.equal(largeResponse.status, 201, JSON.stringify(largeResult));
    assert.equal(largeResult.asset.size, targetSize);
    assert.ok(largeResult.asset.duration > 300);
    console.log('Large local video passed: 500 MiB + 1 KiB streamed, validated and imported.');
  }
  if (process.argv.includes('--browser')) await checkEditorBrowser(base, project.id, asset.id, root, compositionOutputId);
  if (process.argv.includes('--cutting-step-four')) {
    const cuttingUrl = `${base}/api/projects/${project.id}/video-editor/${asset.id}/cutting-project`;
    const savedCutting = await (await fetch(cuttingUrl)).json();
    assert.equal(savedCutting.clips.length, 2, 'reloaded editor should keep the saved composition');
    const projectDb = new Database(join(root, 'data', 'database', 'mowo.db'), { readonly: true });
    assert.equal(projectDb.prepare('SELECT count(*) AS count FROM video_cutting_projects WHERE project_id=? AND source_asset_id=?')
      .get(project.id, asset.id).count, 1, 'repeated saves must update one cutting project');
    assert.equal(projectDb.prepare('SELECT count(*) AS count FROM video_clip_drafts WHERE project_id=? AND source_asset_id=?')
      .get(project.id, asset.id).count, 0, 'cutting edits must not create clip selection drafts');
    projectDb.close();
    assert.equal((await fetch(cuttingUrl, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: savedCutting.revision, clips: [{ id: 'invalid', sourceAssetId: asset.id, inFrame: 0, outFrame: 302 }] }) })).status, 400);
    assert.equal((await fetch(cuttingUrl, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, clips: [] }) })).status, 409);
    assert.equal((await (await fetch(cuttingUrl)).json()).clips.length, 2, 'rejected saves must retain the last project');
    console.log('Cutting project API passed: persisted composition, invalid range and stale revision rejected.');
  }
  if (process.argv.includes('--cutting-playback-modes')) {
    const projectDb = new Database(join(root, 'data', 'database', 'mowo.db'), { readonly: true });
    assert.equal(projectDb.prepare('SELECT count(*) AS count FROM video_clip_drafts WHERE project_id=? AND source_asset_id=?')
      .get(project.id, asset.id).count, 0, 'playback must not create selection drafts');
    projectDb.close();
  }
  const deleted = await fetch(`${base}/api/projects`, { method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [project.id] }) });
  assert.equal(deleted.status, 200, await deleted.text());
  const afterDelete = new Database(join(root, 'data', 'database', 'mowo.db'), { readonly: true });
  assert.equal(afterDelete.prepare('SELECT count(*) AS count FROM video_clips WHERE project_id=?').get(project.id).count, 0);
  assert.equal(afterDelete.prepare('SELECT count(*) AS count FROM video_clip_drafts WHERE project_id=?').get(project.id).count, 0);
  afterDelete.close();
  console.log('Video editor entry passed: 301-second import, editor, Range, frame index, exact frames, clips, drafts and local HEVC preview.');
} catch (error) {
  if (process.argv.includes('--cutting-playback-modes')) console.error('Playback fixture error:', error);
  if (process.argv.includes('--cutting-step-one') || process.argv.includes('--cutting-step-two') || process.argv.includes('--cutting-step-three') || process.argv.includes('--cutting-step-four') || process.argv.includes('--cutting-step-five') || process.argv.includes('--cutting-playback-modes'))
    console.error('Editor fixture failed; recent app output:', logs.slice(-1200));
  throw error;
} finally {
  if (app && app.exitCode === null && app.signalCode === null) {
    const ended = once(app, 'close');
    if (process.platform === 'win32' && app.pid) {
      const stop = spawn('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(stop, 'exit');
    } else app.kill('SIGTERM');
    await ended;
  }
  if (keepFixture) {
    console.log('Retained isolated editor fixture:', root);
  } else {
    const target = await realpath(root);
    assert.ok(target === root && dirname(target) === fixtureParent && basename(target).startsWith('editor-entry-'),
      'cleanup must target the fixture created by this run');
    await rm(target, { recursive: true, maxRetries: 5, retryDelay: 200 });
    console.log('Removed isolated editor fixture:', root);
  }
}
