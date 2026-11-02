import { createDownloadTask } from "@/features/assets/downloaders/server/download-task-service";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { projectId?: unknown; url?: unknown };
    if (typeof body.projectId !== "string" || typeof body.url !== "string") {
      return Response.json({ error: "项目或链接参数无效" }, { status: 400 });
    }
    const task = await createDownloadTask(body.projectId, body.url.trim());
    return Response.json({ task }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法创建下载任务";
    return Response.json({ error: message }, { status: 400 });
  }
}
