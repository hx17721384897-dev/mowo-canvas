import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { invokeEngine } from './engine-client.mjs';

const root = await mkdtemp(resolve('data/video-runtime/中文生命周期-'));
const managed = { root };
const health = await invokeEngine({ action: 'health' }, { managed });
assert.deepEqual(health.map(e => e.event), ['managed', 'health', 'managed', 'done']);
assert.equal(health.at(-2).state, 'stopped');
await assert.rejects(invokeEngine({ action: 'unsupported' }, { managed }), { message: 'video_unsupported_action' });
await invokeEngine({ action: 'health' }, { managed });
const fixture = join(root, 'sleep.py');
await writeFile(fixture, 'import time\nprint(\'{"v":1,"event":"stage","stage":"waiting"}\',flush=True)\ntime.sleep(30)\n');
const cancel = new AbortController();
let ready;
const started = new Promise(accept => { ready = accept; });
const pending = invokeEngine({}, { script: fixture, managed, signal: cancel.signal,
  onEvent: event => { if (event.event === 'stage') ready(); },
});
const rejected = assert.rejects(pending, { message: 'video_cancelled' });
try {
  await started;
  await assert.rejects(invokeEngine({ action: 'health' }, { managed }), { message: 'video_execution_slot_busy' });
} finally { cancel.abort(); }
const stopped = Date.now();
await rejected;
assert.ok(Date.now() - stopped < 5000);
await invokeEngine({ action: 'health' }, { managed });
console.log('Managed engine: Chinese paths, completion after tree cleanup, failed worker cleanup, competing slot, cancellation and reacquisition passed.');
