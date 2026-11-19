import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeEngine } from './engine-client.mjs';
import { readFile } from 'node:fs/promises';

const health = await invokeEngine({ action: 'health' });
assert.equal(health[0].python, JSON.parse(await readFile(new URL('./python-runtime.json', import.meta.url), 'utf8')).version);
assert.equal(health[0].extractor, '2026.10.21');
await assert.rejects(invokeEngine({ action: 'resolve', url: 'https://example.com/SECRET' }),
  { message: 'video_unsupported_url' });
await assert.rejects(invokeEngine({ action: 'unsupported', cookies: { SESSDATA: 'SECRET' } }),
  { message: 'video_unsupported_action' });
const directory = await mkdtemp(join(tmpdir(), 'mowo-video-engine-'));
const fixture = join(directory, 'fixture.py');
try {
  await writeFile(fixture, 'print("not-json", flush=True)\n');
  await assert.rejects(invokeEngine({}, { script: fixture }), { message: 'video_protocol_invalid' });
  await writeFile(fixture, 'import time\ntime.sleep(30)\n');
  const started = Date.now();
  await assert.rejects(invokeEngine({}, { script: fixture, timeoutMs: 100 }), { message: 'video_timeout' });
  assert.ok(Date.now() - started < 5000, 'timeout must terminate the worker promptly');
  const controller = new AbortController();
  const pending = invokeEngine({}, { script: fixture, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { message: 'video_cancelled' });
  await assert.rejects(invokeEngine({}, { python: join(directory, 'missing.exe') }),
    { message: 'video_runtime_unavailable' });
} finally {
  await unlink(fixture);
  await rmdir(directory);
}
console.log('Video engine: health, URL boundary, safe error, malformed protocol, timeout, cancellation, missing runtime passed.');
