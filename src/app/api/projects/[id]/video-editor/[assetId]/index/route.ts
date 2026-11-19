import { ensureFrameIndex, frameAtTime, frameBoundaryAt, frameIndexStatus, frameTimeline } from "@/features/video-editor/server/frame-index";

type Context = RouteContext<"/api/projects/[id]/video-editor/[assetId]/index">;
export async function GET(request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const query = new URL(request.url).searchParams;
  if (query.get("timeline") === "1") {
    const times = await frameTimeline(id, assetId);
    return times ? Response.json({ times }) : Response.json({ error: "帧索引未就绪" }, { status: 404 });
  }
  const frameOrdinal = query.get("frame");
  if (frameOrdinal !== null) {
    if (!/^(0|[1-9]\d{0,11})$/.test(frameOrdinal)) return Response.json({ error: "无效帧号" }, { status: 400 });
    const frame = await frameBoundaryAt(id, assetId, Number(frameOrdinal));
    return frame ? Response.json({ frame }) : Response.json({ error: "帧索引未就绪或帧不存在" }, { status: 404 });
  }
  const at = query.get("at");
  if (at !== null) {
    const seconds = Number(at);
    if (!Number.isFinite(seconds) || seconds < 0) return Response.json({ error: "无效时间" }, { status: 400 });
    const frame = await frameAtTime(id, assetId, seconds);
    return frame ? Response.json({ frame }) : Response.json({ error: "帧索引未就绪" }, { status: 404 });
  }
  const result = await frameIndexStatus(id, assetId);
  return Response.json(result, { status: result.status === "missing" ? 404 : 200 });
}

export async function POST(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const result = await ensureFrameIndex(id, assetId);
  return Response.json(result, { status: result.status === "missing" ? 404 : 202 });
}
