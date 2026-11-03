import assert from "node:assert/strict";
import sharp from "sharp";
import { decodeApngFrames } from "./apng-frame-decoder.ts";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crcTable = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0; });
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const value of data) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length, 0); output.write(type, 4, 4, "ascii"); data.copy(output, 8); output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length); return output; }
function chunksOfType(png: Buffer, wanted: string) { const chunks: Buffer[] = []; let offset = 8; while (offset + 12 <= png.length) { const length = png.readUInt32BE(offset); const type = png.toString("ascii", offset + 4, offset + 8); if (type === wanted) chunks.push(Buffer.from(png.subarray(offset + 8, offset + 8 + length))); offset += length + 12; } return chunks; }
function frameControl(sequence: number, delay: number) { const data = Buffer.alloc(26); data.writeUInt32BE(sequence, 0); data.writeUInt32BE(2, 4); data.writeUInt32BE(1, 8); data.writeUInt16BE(delay, 20); data.writeUInt16BE(1000, 22); data[24] = 0; data[25] = 0; return chunk("fcTL", data); }

const red = await sharp(Buffer.from([255, 0, 0, 255, 255, 0, 0, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
const blue = await sharp(Buffer.from([0, 0, 255, 255, 0, 0, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
const header = chunksOfType(red, "IHDR")[0];
const animationControl = Buffer.alloc(8); animationControl.writeUInt32BE(2, 0); animationControl.writeUInt32BE(0, 4);
const secondData = Buffer.concat([Buffer.from([0, 0, 0, 2]), ...chunksOfType(blue, "IDAT")]);
const apng = Buffer.concat([signature, chunk("IHDR", header), chunk("acTL", animationControl), frameControl(0, 80), ...chunksOfType(red, "IDAT").map((data) => chunk("IDAT", data)), frameControl(1, 120), chunk("fdAT", secondData), chunk("IEND", Buffer.alloc(0))]);

const result = await decodeApngFrames(apng);
assert.equal(result.frames.length, 2);
assert.deepEqual(result.frames.map((frame) => frame.durationMs), [80, 120]);
const first = await sharp(result.frames[0].buffer).raw().toBuffer();
const second = await sharp(result.frames[1].buffer).raw().toBuffer();
assert.deepEqual([...first.subarray(0, 4)], [255, 0, 0, 255]);
assert.deepEqual([...second.subarray(0, 4)], [0, 0, 255, 255]);
console.log("APNG frame extraction tests passed");
