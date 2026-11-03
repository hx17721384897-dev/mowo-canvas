import { saveFrameSequence, toFrameExtractionError } from "@/features/frame-extraction/server/frame-extraction-service";

export async function POST(_request: Request, context: RouteContext<"/api/frame-extraction/tasks/[taskId]/sources/[sourceId]/save">) {
  try {
    const { taskId, sourceId } = await context.params;
    return Response.json({ sequence: await saveFrameSequence(taskId, sourceId) });
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
