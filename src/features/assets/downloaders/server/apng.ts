const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

type AnimationControlChunk = {
  dataStart: number;
  dataEnd: number;
  typeStart: number;
};

export function isPng(data: Uint8Array) {
  return data.length >= pngSignature.length && pngSignature.every((value, index) => data[index] === value);
}

function findAnimationControl(data: Uint8Array): AnimationControlChunk | null {
  if (!isPng(data)) return null;

  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let offset = pngSignature.length;
  while (offset + 12 <= view.length) {
    const length = view.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > view.length) return null;

    const type = view.toString("ascii", typeStart, dataStart);
    if (type === "acTL" && length === 8) return { dataStart, dataEnd, typeStart };
    if (type === "IEND") return null;
    offset = chunkEnd;
  }
  return null;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const value of data) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isAnimatedPng(data: Uint8Array) {
  return findAnimationControl(data) !== null;
}

export function apngFrameCount(data: Buffer) {
  const control = findAnimationControl(data);
  return control ? data.readUInt32BE(control.dataStart) : 1;
}

export function makeApngLoopForever(data: Uint8Array) {
  const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const control = findAnimationControl(source);
  if (!control || source.readUInt32BE(control.dataStart + 4) === 0) return source;

  const normalized = Buffer.from(source);
  normalized.writeUInt32BE(0, control.dataStart + 4);
  normalized.writeUInt32BE(crc32(normalized.subarray(control.typeStart, control.dataEnd)), control.dataEnd);
  return normalized;
}
