import assert from 'node:assert/strict';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { invokeEngine } from './engine-client.mjs';

// Explicit live experiment using the user's sample; emits only safe events.
const root = resolve('data/video-runtime');
const ffmpeg = join(root, 'tools/ffmpeg.exe');
const ffprobe = join(root, 'tools/ffprobe.exe');
await stat(ffmpeg); await stat(ffprobe);
const request = { url: 'https://www.bilibili.com/video/BV1bv411T7et/', credentialFile: join(root, 'bilibili.credentials'), ffmpeg };
const events = await invokeEngine({ ...request, action: 'resolve' });
const video = events.find(e => e.event === 'resolved').video;
const audio = video.formats.filter(f => f.vcodec === 'none' && f.acodec?.startsWith('mp4a')).sort((a, b) => b.tbr - a.tbr)[0];
const avc = video.formats.filter(f => f.vcodec?.startsWith('avc1')).sort((a, b) => b.height - a.height)[0];
const hevc = video.formats.filter(f => /^(hev1|hvc1)/.test(f.vcodec)).sort((a, b) => b.height - a.height)[0];
assert.ok(audio && avc && hevc, 'sample must provide both AVC and HEVC plus AAC');
const runRoot = join(root, 'live-media-' + Date.now());
const resumedDirectory = join(runRoot, 'recovery');
const hevcDirectory = join(runRoot, 'hevc');
await mkdir(resumedDirectory, { recursive: true }); await mkdir(hevcDirectory);
const controller = new AbortController();
await assert.rejects(invokeEngine({ ...request, action: 'download', formatIds: [avc.format_id, audio.format_id],
  directory: resumedDirectory, rateLimit: 131072 }, {
  timeoutMs: 90000, signal: controller.signal,
  onEvent: e => { if (e.event === 'progress' && e.downloaded >= 262144) controller.abort(); },
}), { message: 'video_cancelled' });
let partialBytes = 0;
for (const name of await readdir(resumedDirectory)) if (name.endsWith('.part')) partialBytes += (await stat(join(resumedDirectory, name))).size;
assert.ok(partialBytes >= 262144, 'cancelled download must leave partial bytes for this experiment');
const recovery = [];
await invokeEngine({ ...request, action: 'download', formatIds: [avc.format_id, audio.format_id], directory: resumedDirectory }, {
  timeoutMs: 180000, onEvent: e => { if (e.event === 'recovery') { recovery.push(e); console.log(e); } },
});
assert.ok(recovery.some(e => e.mode === 'continued' && e.bytes > 0), 'the sample server must actually accept a nonzero Range to claim continuation');
const resumedProbe = (await invokeEngine({ action: 'probe', file: join(resumedDirectory, 'source.mp4'), ffprobe, requireAudio: true }))[0];
assert.ok(resumedProbe.browserCandidate);
await invokeEngine({ ...request, action: 'download', formatIds: [hevc.format_id, audio.format_id], directory: hevcDirectory }, { timeoutMs: 180000 });
const source = join(hevcDirectory, 'source.mp4');
const target = join(hevcDirectory, 'preview.mp4');
const sourceProbe = (await invokeEngine({ action: 'probe', file: source, ffprobe, requireAudio: true }))[0];
assert.ok(sourceProbe.streams.some(s => s.codec_name === 'hevc'));
const preview = (await invokeEngine({ action: 'preview', file: source, target, ffmpeg, ffprobe }, { timeoutMs: 180000 })).find(e => e.event === 'previewed');
assert.ok(preview.browserCandidate);
const summary = { id: video.id, partialBytes, recovery, resumed: resumedProbe, hevc: sourceProbe, preview, previewFile: target };
await writeFile(join(runRoot, 'result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
