import { importDownloadTask } from "@/features/assets/downloaders/server/download-task-service";

export async function POST(request: Request, context: RouteContext<"/api/download-tasks/[id]/import">) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { itemIds?: unknown; discardUnselected?: unknown };
    if (!Array.isArray(body.itemIds) || !body.itemIds.every((value) => typeof value === "string") || typeof body.discardUnselected !== "boolean") {
      return Response.json({ error: "导入参数无效" }, { status: 400 });
    }
    const result = await importDownloadTask(id, body.itemIds, body.discardUnselected);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入下载结果失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
