import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getAssetContent } from "@/features/assets/server/asset-catalog";
import { parseByteRange } from "@/features/assets/server/byte-range";

async function content(request: Request, assetId: string, head = false) {
  try {
    const asset = await getAssetContent(assetId);
    if (!asset) return new Response("Not found", { status: 404 });
    const { size } = await stat(asset.path);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      "Content-Type": asset.mimeType, "X-Content-Type-Options": "nosniff" });
    const rangeHeader = head ? null : request.headers.get("range");
    const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
    if (rangeHeader && !range) { headers.set("Content-Range", `bytes */${size}`); return new Response(null, { status: 416, headers }); }
    const start = range?.start ?? 0, end = range?.end ?? size - 1;
    headers.set("Content-Length", String(range ? end - start + 1 : size));
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    const body = head || !size ? null : Readable.toWeb(createReadStream(asset.path, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch { return new Response("Not found", { status: 404 }); }
}
export async function GET(request: Request, context: RouteContext<"/api/assets/[id]/content">) {
  return content(request, (await context.params).id);
}
export async function HEAD(request: Request, context: RouteContext<"/api/assets/[id]/content">) {
  return content(request, (await context.params).id, true);
}
