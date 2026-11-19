import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, access, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { invokeEngine } from './engine-client.mjs';

const root = resolve('data/video-runtime');
let directory;
for (const name of (await readdir(root)).filter(n => n.startsWith('live-media-')).sort().reverse()) {
  const candidate = join(root, name);
  try {
    await access(join(candidate, 'hevc/source.mp4')); await access(join(candidate, 'recovery/source.mp4'));
    directory = candidate; break;
  } catch { /* Skip an interrupted attempt; never treat partial media as complete. */ }
}
assert.ok(directory, 'A completed live-media sample is required');
const ffmpeg = join(root, 'tools/ffmpeg.exe'); const ffprobe = join(root, 'tools/ffprobe.exe');
const source = join(directory, 'hevc/source.mp4');
const target = join(directory, 'hevc/managed-preview.mp4');
async function hash(file) {
  const digest = createHash('sha256');
  for await (const block of createReadStream(file)) digest.update(block);
  return digest.digest('hex');
}
const before = await hash(source);
const result = await invokeEngine({ action: 'preview', file: source, target, ffmpeg, ffprobe }, { timeoutMs: 180000 });
const preview = result.find(e => e.event === 'previewed');
assert.ok(preview?.browserCandidate);
assert.equal(result.at(-2).state, 'stopped'); assert.equal(result.at(-1).event, 'done');
assert.equal(await hash(source), before);
for (const file of [target, join(directory, 'recovery/source.mp4')]) {
  const child = spawn(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { windowsHide: true, stdio: 'ignore' });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, 'Full media decode must pass');
}
const summary = { preview, originalUnchanged: true, fullDecode: true, lifecycle: result.filter(e => e.event === 'managed') };
await writeFile(join(directory, 'managed-result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
