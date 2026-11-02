import { referenceAssets } from "@/features/assets/server/asset-catalog";

export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/assets/reference">) {
  try {
    const { id } = await context.params;
    const payload = await request.json() as { assetIds?: unknown };
    if (!Array.isArray(payload.assetIds) || !payload.assetIds.every((value) => typeof value === "string")) {
      return Response.json({ error: "请选择有效资产" }, { status: 400 });
    }

    const assets = await referenceAssets(id, payload.assetIds);
    return Response.json({ assets });
  } catch {
    return Response.json({ error: "添加历史资产失败" }, { status: 400 });
  }
}
