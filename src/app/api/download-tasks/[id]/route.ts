import { cancelDownloadTask, getDownloadTask } from "@/features/assets/downloaders/server/download-task-service";

export async function GET(_request: Request, context: RouteContext<"/api/download-tasks/[id]">) {
  const { id } = await context.params;
  const task = await getDownloadTask(id);
  if (!task) return Response.json({ error: "下载任务不存在" }, { status: 404 });
  return Response.json({ task });
}

export async function DELETE(_request: Request, context: RouteContext<"/api/download-tasks/[id]">) {
  const { id } = await context.params;
  const task = await cancelDownloadTask(id);
  if (!task) return Response.json({ error: "下载任务不存在" }, { status: 404 });
  return Response.json({ task });
}
