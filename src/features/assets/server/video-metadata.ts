import { open } from "node:fs/promises";

type Box = { type: string; start: number; end: number };
export function mp4Boxes(buffer: Buffer, start = 0, end = buffer.length): Box[] {
  const result: Box[] = [];
  while (start < end) {
    if (result.length >= 10000) throw new Error("视频容器结构过于复杂");
    if (start + 8 > end) throw new Error("视频容器损坏");
    let size = buffer.readUInt32BE(start), header = 8;
    if (size === 1) { if (start + 16 > end) throw new Error("视频容器损坏"); size = Number(buffer.readBigUInt64BE(start + 8)); header = 16; }
    if (size === 0) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || start + size > end) throw new Error("视频容器损坏");
    result.push({ type: buffer.toString("ascii", start + 4, start + 8), start: start + header, end: start + size });
    start += size;
  }
  return result;
}
export function parseMovie(buffer: Buffer) {
  const boxes = mp4Boxes(buffer);
  const mvhd = boxes.find((box) => box.type === "mvhd");
  if (!mvhd) throw new Error("无法读取视频时长");
  const movie = buffer.subarray(mvhd.start, mvhd.end);
  if (![0, 1].includes(movie[0]) || movie.length < (movie[0] === 1 ? 32 : 20)) throw new Error("视频时长数据损坏");
  const scale = movie.readUInt32BE(movie[0] === 1 ? 20 : 12);
  const ticks = movie[0] === 1 ? Number(movie.readBigUInt64BE(24)) : movie.readUInt32BE(16);
  const duration = ticks / scale;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法确认视频时长，暂不支持此视频容器");
  for (const track of boxes.filter((box) => box.type === "trak")) {
    const children = mp4Boxes(buffer, track.start, track.end);
    const media = children.find((box) => box.type === "mdia");
    const header = children.find((box) => box.type === "tkhd");
    if (!media || !header) continue;
    const handler = mp4Boxes(buffer, media.start, media.end).find((box) => box.type === "hdlr");
    if (!handler || handler.end - handler.start < 12 || buffer.toString("ascii", handler.start + 8, handler.start + 12) !== "vide") continue;
    if (header.end - header.start < 84) continue;
    const width = Math.round(buffer.readUInt32BE(header.end - 8) / 65536);
    const height = Math.round(buffer.readUInt32BE(header.end - 4) / 65536);
    if (width > 0 && height > 0) return { width, height, duration };
  }
  throw new Error("文件没有可用的视频轨道");
}
export async function readVideoMetadata(path: string) {
  const file = await open(path, "r");
  try {
    const { size: total } = await file.stat();
    let offset = 0, movie: Buffer | undefined, validType = false, media = false;
    let boxCount = 0;
    while (offset < total) {
      if (++boxCount > 10000) throw new Error("视频容器结构过于复杂");
      const head = Buffer.alloc(16);
      const { bytesRead } = await file.read(head, 0, 16, offset);
      if (bytesRead < 8) throw new Error("视频容器损坏");
      const type = head.toString("ascii", 4, 8);
      const declared = head.readUInt32BE(0);
      const header = declared === 1 ? 16 : 8;
      if (declared === 1 && bytesRead < 16) throw new Error("视频容器损坏");
      const size = declared === 1 ? Number(head.readBigUInt64BE(8)) : declared === 0 ? total - offset : declared;
      if (!Number.isSafeInteger(size) || size < header || offset + size > total) throw new Error("视频容器损坏");
      if (type === "ftyp") validType = true;
      if (type === "mdat" && size > header) media = true;
      if (type === "moov") {
        if (size > 16 * 1024 * 1024) throw new Error("视频元数据过大，暂不支持");
        movie = Buffer.alloc(size - header);
        let loaded = 0;
        while (loaded < movie.length) {
          const read = await file.read(movie, loaded, movie.length - loaded, offset + header + loaded);
          if (!read.bytesRead) throw new Error("视频读取不完整");
          loaded += read.bytesRead;
        }
      }
      offset += size;
    }
    if (!validType || !movie || !media) throw new Error("请使用有效的 MP4、M4V 或 MOV 视频");
    return parseMovie(movie);
  } finally { await file.close(); }
}
