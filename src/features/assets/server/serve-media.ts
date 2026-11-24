import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parseByteRange } from "./byte-range.ts";

function mediaBody(request: Request, path: string, start: number, end: number): ReadableStream<Uint8Array> {
  let source: ReturnType<typeof createReadStream> | null = null;
  let closed = false;
  const abort = () => {
    if (closed) return;
    closed = true;
    request.signal.removeEventListener("abort", abort);
    source?.destroy();
    controller.close();
  };
  let controller: ReadableStreamDefaultController<Uint8Array>;
  return new ReadableStream<Uint8Array>({
    start(target) {
      controller = target;
      if (request.signal.aborted) { closed = true; target.close(); return; }
      source = createReadStream(path, { start, end });
      request.signal.addEventListener("abort", abort, { once: true });
      source.on("data", (chunk: string | Buffer) => {
        if (closed) return;
        target.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        if (target.desiredSize !== null && target.desiredSize <= 0) source?.pause();
      });
      source.once("end", () => { if (!closed) { closed = true; request.signal.removeEventListener("abort", abort); target.close(); } });
      source.once("error", (error) => { if (!closed) { closed = true; request.signal.removeEventListener("abort", abort); target.error(error); } });
    },
    pull() { source?.resume(); },
    cancel() { closed = true; request.signal.removeEventListener("abort", abort); source?.destroy(); },
  });
}

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
  const body = head || !size ? null : mediaBody(request, file.path, start, end);
  return new Response(body, { status: range ? 206 : 200, headers });
}
