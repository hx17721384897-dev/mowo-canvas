import { toFrameExtractionError, updateFrameSequenceDraft } from "@/features/frame-extraction/server/frame-extraction-service";

export async function PATCH(request: Request, context: RouteContext<"/api/frame-extraction/tasks/[taskId]/sources/[sourceId]">) {
  try {
    const { taskId, sourceId } = await context.params;
    const body = await request.json() as { orderedFrameIds?: unknown; duration?: { frameId: string; durationMs: number } };
    if (!Array.isArray(body.orderedFrameIds) || body.orderedFrameIds.some((id) => typeof id !== "string")) {
      return Response.json({ error: "帧顺序无效", code: "INVALID_REQUEST" }, { status: 400 });
    }
    if (body.duration !== undefined && (!body.duration || !body.orderedFrameIds.includes(body.duration.frameId)
      || !Number.isInteger(body.duration.durationMs) || body.duration.durationMs < 1 || body.duration.durationMs > 3600000)) {
      return Response.json({ error: "帧时长无效", code: "INVALID_REQUEST" }, { status: 400 });
    }
    return Response.json({ task: await updateFrameSequenceDraft(taskId, sourceId, body.orderedFrameIds as string[], body.duration) });
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
