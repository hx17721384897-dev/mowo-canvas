import { getFrameExtractionTask, toFrameExtractionError } from "@/features/frame-extraction/server/frame-extraction-service";

export async function GET(_request: Request, context: RouteContext<"/api/frame-extraction/tasks/[taskId]">) {
  try {
    const { taskId } = await context.params;
    const task = await getFrameExtractionTask(taskId);
    if (!task) return Response.json({ error: "拆帧任务不存在", code: "TASK_NOT_FOUND" }, { status: 404 });
    return Response.json({ task });
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
