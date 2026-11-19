import { moveOriginalAsset } from "@/features/assets/server/source-folders";

export async function PUT(request: Request, context: RouteContext<"/api/projects/[id]/asset-folders/placement">) {
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("assetId" in body) || typeof body.assetId !== "string"
    || !("folderId" in body) || (body.folderId !== null && typeof body.folderId !== "string"))
    return Response.json({ error: "素材位置无效" }, { status: 400 });
  try { await moveOriginalAsset(id, body.assetId, body.folderId); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "移动失败" }, { status: 400 }); }
}
