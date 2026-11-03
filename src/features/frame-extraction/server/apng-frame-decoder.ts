import sharp from "sharp";
import { isAnimatedPng } from "../../assets/downloaders/server/apng.ts";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

type Control = { width: number; height: number; x: number; y: number; delayMs: number; dispose: number; blend: number };
type ParsedFrame = { control: Control; compressed: Buffer[] };

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const value of data) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, "ascii");
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}

function delayMs(numerator: number, denominator: number) {
  return Math.max(20, Math.round(1000 * numerator / (denominator || 100)));
}

function parseControl(data: Buffer): Control {
  return {
    width: data.readUInt32BE(4), height: data.readUInt32BE(8), x: data.readUInt32BE(12), y: data.readUInt32BE(16),
    delayMs: delayMs(data.readUInt16BE(20), data.readUInt16BE(22)), dispose: data[24], blend: data[25],
  };
}

function parseApng(source: Buffer) {
  if (!isAnimatedPng(source)) throw new Error("不是 APNG 动图");
  let offset = signature.length;
  let ihdr: Buffer | null = null;
  const shared: Buffer[] = [];
  const frames: ParsedFrame[] = [];
  let current: ParsedFrame | null = null;
  let sawImageData = false;
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") ihdr = Buffer.from(data);
    else if (type === "fcTL") { current = { control: parseControl(data), compressed: [] }; frames.push(current); }
    else if (type === "IDAT") { sawImageData = true; if (current) current.compressed.push(Buffer.from(data)); }
    else if (type === "fdAT") { sawImageData = true; if (current) current.compressed.push(Buffer.from(data.subarray(4))); }
    else if (!sawImageData && !["acTL", "IEND"].includes(type)) shared.push(Buffer.from(source.subarray(offset, offset + length + 12)));
    if (type === "IEND") break;
    offset += length + 12;
  }
  if (!ihdr || frames.length < 2 || frames.some((frame) => !frame.compressed.length)) throw new Error("APNG 帧结构不完整");
  return { ihdr, shared, frames, width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4) };
}

function framePng(ihdr: Buffer, shared: Buffer[], frame: ParsedFrame) {
  const header = Buffer.from(ihdr);
  header.writeUInt32BE(frame.control.width, 0);
  header.writeUInt32BE(frame.control.height, 4);
  return Buffer.concat([signature, chunk("IHDR", header), ...shared, ...frame.compressed.map((data) => chunk("IDAT", data)), chunk("IEND", Buffer.alloc(0))]);
}

function blendOver(target: Buffer, targetOffset: number, source: Buffer, sourceOffset: number) {
  const alpha = source[sourceOffset + 3] / 255;
  const targetAlpha = target[targetOffset + 3] / 255;
  const outputAlpha = alpha + targetAlpha * (1 - alpha);
  if (outputAlpha <= 0) { target.fill(0, targetOffset, targetOffset + 4); return; }
  for (let channel = 0; channel < 3; channel += 1) target[targetOffset + channel] = Math.round((source[sourceOffset + channel] * alpha + target[targetOffset + channel] * targetAlpha * (1 - alpha)) / outputAlpha);
  target[targetOffset + 3] = Math.round(outputAlpha * 255);
}

export async function decodeApngFrames(source: Buffer) {
  const parsed = parseApng(source);
  let canvas = Buffer.alloc(parsed.width * parsed.height * 4);
  const output: Array<{ buffer: Buffer; durationMs: number }> = [];
  for (const frame of parsed.frames) {
    const before = Buffer.from(canvas);
    const pixels = await sharp(framePng(parsed.ihdr, parsed.shared, frame)).ensureAlpha().raw().toBuffer();
    const control = frame.control;
    for (let y = 0; y < control.height; y += 1) {
      for (let x = 0; x < control.width; x += 1) {
        const sourceOffset = (y * control.width + x) * 4;
        const targetOffset = ((control.y + y) * parsed.width + control.x + x) * 4;
        if (control.blend === 0) pixels.copy(canvas, targetOffset, sourceOffset, sourceOffset + 4);
        else blendOver(canvas, targetOffset, pixels, sourceOffset);
      }
    }
    output.push({ buffer: await sharp(canvas, { raw: { width: parsed.width, height: parsed.height, channels: 4 } }).png().toBuffer(), durationMs: control.delayMs });
    if (control.dispose === 1) {
      for (let y = 0; y < control.height; y += 1) canvas.fill(0, ((control.y + y) * parsed.width + control.x) * 4, ((control.y + y) * parsed.width + control.x + control.width) * 4);
    } else if (control.dispose === 2) canvas = before;
  }
  return { width: parsed.width, height: parsed.height, frames: output };
}
