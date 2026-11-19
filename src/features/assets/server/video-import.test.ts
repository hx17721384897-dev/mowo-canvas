import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mp4Boxes, parseMovie, readVideoMetadata } from "./video-metadata.ts";
import { parseByteRange } from "./byte-range.ts";
import { needsVideoEditor, VIDEO_MAX_BYTES } from "../video-policy.ts";
function box(type: string, data: Buffer) { const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(type, 4); return Buffer.concat([header, data]); }
const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(300000, 16);
const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(1920 * 65536, 76); tkhd.writeUInt32BE(1080 * 65536, 80);
const handler = Buffer.alloc(24); handler.write("vide", 8);
const movie = Buffer.concat([box("mvhd", mvhd), box("trak", Buffer.concat([box("tkhd", tkhd), box("mdia", box("hdlr", handler))]))]);
assert.deepEqual(parseMovie(movie), { width: 1920, height: 1080, duration: 300 });
assert.equal(needsVideoEditor(VIDEO_MAX_BYTES, 300), false);
assert.equal(needsVideoEditor(VIDEO_MAX_BYTES + 1, 300), true);
assert.equal(needsVideoEditor(1, 300.001), true);
assert.throws(() => parseMovie(Buffer.alloc(0)));
assert.throws(() => mp4Boxes(Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])));
assert.deepEqual(parseByteRange("bytes=0-99", 50), { start: 0, end: 49 });
assert.deepEqual(parseByteRange("bytes=20-", 50), { start: 20, end: 49 });
assert.deepEqual(parseByteRange("bytes=-10", 50), { start: 40, end: 49 });
for (const range of ["bytes=50-", "bytes=9-2", "bytes=-0", "bytes=", "bytes=0-1,3-4"]) assert.equal(parseByteRange(range, 50), null);
const directory = await mkdtemp(join(tmpdir(), "mowo-video-test-"));
try {
  const file = join(directory, "sample.mp4");
  await writeFile(file, Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("mdat", Buffer.from([1, 2, 3])), box("moov", movie)]));
  assert.deepEqual(await readVideoMetadata(file), { width: 1920, height: 1080, duration: 300 });
  await writeFile(file, box("moov", movie));
  await assert.rejects(readVideoMetadata(file));
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("Video metadata, import thresholds and HTTP ranges verified");
