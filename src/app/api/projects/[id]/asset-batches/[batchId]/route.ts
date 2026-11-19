import { renameDownloadBatch } from "@/features/assets/server/source-folders";

export async function PATCH(request: Request, context: RouteContext<"/api/projects/[id]/asset-batches/[batchId]">) {
  const { id, batchId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string")
    return Response.json({ error: "批次名称无效" }, { status: 400 });
  try { await renameDownloadBatch(id, batchId, body.name); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "改名失败" }, { status: 400 }); }
}
