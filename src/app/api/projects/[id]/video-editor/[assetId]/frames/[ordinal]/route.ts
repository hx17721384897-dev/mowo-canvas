import { sourceFrame } from "@/features/video-editor/server/frame-index";

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/video-editor/[assetId]/frames/[ordinal]">) {
  const { id, assetId, ordinal: rawOrdinal } = await context.params;
  if (!/^(0|[1-9]\d{0,11})$/.test(rawOrdinal)) return Response.json({ error: "无效帧号" }, { status: 400 });
  try {
    const frame = await sourceFrame(id, assetId, Number(rawOrdinal));
    if (!frame) return Response.json({ error: "帧索引未就绪或帧不存在" }, { status: 404 });
    return new Response(new Uint8Array(frame.image), { headers: { "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60", "X-Source-Frame": rawOrdinal, "X-Source-Pts": String(frame.pts),
      "X-Source-Time": String(frame.seconds) } });
  } catch {
    return Response.json({ error: "源帧读取失败，请重试或重建索引" }, { status: 500 });
  }
}
