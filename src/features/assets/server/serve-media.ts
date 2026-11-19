import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseByteRange } from "./byte-range";

export async function serveMedia(request: Request, file: { path: string; name: string; mimeType: string }, head = false, cache = "no-store") {
  const { size } = await stat(file.path);
  const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": cache, "Content-Type": file.mimeType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, "X-Content-Type-Options": "nosniff" });
  const rangeHeader = head ? null : request.headers.get("range");
  const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
  if (rangeHeader && !range) { headers.set("Content-Range", `bytes */${size}`); return new Response(null, { status: 416, headers }); }
  const start = range?.start ?? 0, end = range?.end ?? size - 1;
  headers.set("Content-Length", String(range ? end - start + 1 : size));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const body = head || !size ? null : Readable.toWeb(createReadStream(file.path, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
