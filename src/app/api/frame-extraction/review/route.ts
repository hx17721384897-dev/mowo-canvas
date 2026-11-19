import { reviewFrameInputs, toFrameExtractionError } from "@/features/frame-extraction/server/frame-extraction-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { projectId?: unknown; assetIds?: unknown; taskId?: unknown } | null;
  if (!body || typeof body.projectId !== "string" || !Array.isArray(body.assetIds)
    || body.assetIds.length > 500 || body.assetIds.some((id) => typeof id !== "string")) {
    return Response.json({ error: "检查参数无效或图片超过 500 张" }, { status: 400 });
  }
  try {
    const items = await reviewFrameInputs(body.projectId, body.assetIds, typeof body.taskId === "string" ? body.taskId : undefined);
    return Response.json({ items });
  } catch (error) {
    const failure = toFrameExtractionError(error);
    return Response.json({ error: failure.status === 500 ? "检查输入失败，请重试" : failure.message }, { status: failure.status });
  }
}
