import { createFrameExtractionTask, toFrameExtractionError } from "@/features/frame-extraction/server/frame-extraction-service";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { projectId?: unknown; assetIds?: unknown; taskId?: unknown };
    if (typeof body.projectId !== "string" || !Array.isArray(body.assetIds) || body.assetIds.some((id) => typeof id !== "string")) {
      return Response.json({ error: "请求参数不完整", code: "INVALID_REQUEST" }, { status: 400 });
    }
    return Response.json({ task: await createFrameExtractionTask(body.projectId, body.assetIds as string[], typeof body.taskId === "string" ? body.taskId : undefined) }, { status: 201 });
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
