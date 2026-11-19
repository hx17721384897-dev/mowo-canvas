import { importImageBuffers, importLocalImages, listProjectAssets, listProjectSequences } from "@/features/assets/server/asset-catalog";
import { recordCropDerivations } from "@/features/assets/server/asset-derivation";
import { listAssetSourceView } from "@/features/assets/server/asset-source-view";

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/assets">) {
  const { id } = await context.params;
  const assets = await listProjectAssets(id, true);
  return Response.json({ assets, sequences: await listProjectSequences(id, assets), sourceView: await listAssetSourceView(id) });
}

export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/assets">) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const cropSourceId = formData.get("cropSourceAssetId");
    const cropSourceIds = formData.get("cropSourceAssetIds");
    if (cropSourceIds !== null) {
      let sourceIds: unknown;
      try { sourceIds = JSON.parse(String(cropSourceIds)); } catch { return Response.json({ error: "裁切来源列表无效" }, { status: 400 }); }
      if (!Array.isArray(sourceIds) || sourceIds.length !== files.length || !files.length || files.length > 500
        || sourceIds.some((value) => typeof value !== "string" || !/^[\w-]{1,128}$/.test(value))
        || files.some((file) => file.type !== "image/png")) {
        return Response.json({ error: "裁切来源或结果文件无效" }, { status: 400 });
      }
      const validIds = new Set((await listProjectAssets(id)).map((asset) => asset.id));
      if (sourceIds.some((value) => !validIds.has(value))) return Response.json({ error: "裁切来源不属于当前项目" }, { status: 400 });
      const result = await importImageBuffers(id, await Promise.all(files.map(async (file, index) => ({
        buffer: Buffer.from(await file.arrayBuffer()), name: file.name, mimeType: "image/png" as const,
        sourceType: "image-crop", sourceUrl: `asset:${sourceIds[index]}`,
      }))));
      await recordCropDerivations(id, sourceIds, result.importedIds);
      return Response.json(result, { status: 201 });
    }
    if (cropSourceId !== null) {
      if (typeof cropSourceId !== "string" || !/^[\w-]{1,128}$/.test(cropSourceId)
        || !(await listProjectAssets(id)).some((asset) => asset.id === cropSourceId)) {
        return Response.json({ error: "裁切来源不属于当前项目" }, { status: 400 });
      }
      if (!files.length || files.length > 500 || files.some((file) => file.type !== "image/png")) {
        return Response.json({ error: "裁切结果必须是 PNG 图片" }, { status: 400 });
      }
      const result = await importImageBuffers(id, await Promise.all(files.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()), name: file.name, mimeType: "image/png" as const,
        sourceType: "image-crop", sourceUrl: `asset:${cropSourceId}`,
      }))));
      await recordCropDerivations(id, result.importedIds.map(() => cropSourceId), result.importedIds);
      return Response.json(result, { status: 201 });
    }
    const result = await importLocalImages(id, files);
    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入图片失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
