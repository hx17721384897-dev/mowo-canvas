import { toFrameExtractionError, updateFrameSequenceDraft } from "@/features/frame-extraction/server/frame-extraction-service";

export async function PATCH(request: Request, context: RouteContext<"/api/frame-extraction/tasks/[taskId]/sources/[sourceId]">) {
  try {
    const { taskId, sourceId } = await context.params;
    const body = await request.json() as { orderedFrameIds?: unknown };
    if (!Array.isArray(body.orderedFrameIds) || body.orderedFrameIds.some((id) => typeof id !== "string")) {
      return Response.json({ error: "帧顺序无效", code: "INVALID_REQUEST" }, { status: 400 });
    }
    return Response.json({ task: await updateFrameSequenceDraft(taskId, sourceId, body.orderedFrameIds as string[]) });
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
