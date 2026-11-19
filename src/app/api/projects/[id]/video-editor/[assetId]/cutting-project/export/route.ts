import { CompositionDeliveryError, downloadComposition } from "@/features/video-editor/server/deliver-composition";

export async function GET(request: Request,
  context: RouteContext<"/api/projects/[id]/video-editor/[assetId]/cutting-project/export">) {
  const { id, assetId } = await context.params;
  const revision = Number(new URL(request.url).searchParams.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 0) return Response.json({ error: "工程版本无效" }, { status: 400 });
  try { return await downloadComposition(id, assetId, revision, request.signal); }
  catch (error) {
    if (error instanceof CompositionDeliveryError) return Response.json({ error: error.message }, { status: error.status });
    if (request.signal.aborted) return Response.json({ error: "导出已取消" }, { status: 499 });
    console.error("Composition export failed", { projectId: id, assetId, error });
    return Response.json({ error: "成片导出失败，请重试" }, { status: 500 });
  }
}
