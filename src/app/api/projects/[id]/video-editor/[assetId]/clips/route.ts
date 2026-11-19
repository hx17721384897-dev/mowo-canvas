import { listProjectAssets } from "@/features/assets/server/asset-catalog";
import { ClipError, saveVideoClip } from "@/features/video-editor/server/clips";

type Context = RouteContext<"/api/projects/[id]/video-editor/[assetId]/clips">;
export async function GET(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const assets = await listProjectAssets(id);
  if (!assets.some((asset) => asset.id === assetId && asset.type === "video" && !asset.clip))
    return Response.json({ error: "原视频不属于此项目" }, { status: 404 });
  return Response.json({ clips: assets.filter((asset) => asset.clip?.sourceAssetId === assetId) });
}

export async function POST(request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const input = await request.json().catch(() => null) as {
    intentId?: unknown; startFrame?: unknown; endFrame?: unknown; name?: unknown;
  } | null;
  if (!input || typeof input.intentId !== "string" || !Number.isSafeInteger(input.startFrame)
    || !Number.isSafeInteger(input.endFrame) || (input.name !== undefined && typeof input.name !== "string"))
    return Response.json({ error: "片段参数无效" }, { status: 400 });
  try {
    const clip = await saveVideoClip(id, assetId, { intentId: input.intentId,
      startFrame: input.startFrame as number, endFrame: input.endFrame as number, name: input.name as string | undefined });
    return Response.json({ clip }, { status: 201 });
  } catch (error) {
    if (error instanceof ClipError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
