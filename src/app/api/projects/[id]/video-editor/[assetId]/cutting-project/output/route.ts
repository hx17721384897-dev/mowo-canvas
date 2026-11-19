import { CompositionDeliveryError, saveComposition } from "@/features/video-editor/server/deliver-composition";

export async function POST(request: Request,
  context: RouteContext<"/api/projects/[id]/video-editor/[assetId]/cutting-project/output">) {
  const { id, assetId } = await context.params;
  const input = await request.json().catch(() => null) as { expectedRevision?: unknown } | null;
  if (!input || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0)
    return Response.json({ error: "工程版本无效" }, { status: 400 });
  try { return Response.json(await saveComposition(id, assetId, input.expectedRevision as number, request.signal)); }
  catch (error) {
    if (error instanceof CompositionDeliveryError) return Response.json({ error: error.message }, { status: error.status });
    if (request.signal.aborted) return Response.json({ error: "保存已取消" }, { status: 499 });
    console.error("Composition save failed", { projectId: id, assetId, error });
    return Response.json({ error: "成片保存失败，请重试" }, { status: 500 });
  }
}
