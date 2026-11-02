import { importLocalImages, listProjectAssets } from "@/features/assets/server/asset-catalog";

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/assets">) {
  const { id } = await context.params;
  return Response.json({ assets: await listProjectAssets(id) });
}

export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/assets">) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const result = await importLocalImages(id, files);
    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入图片失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
