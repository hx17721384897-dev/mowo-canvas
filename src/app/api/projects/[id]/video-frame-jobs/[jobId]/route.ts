import { readVideoJson, videoFrameJobResponse } from "@/features/frame-extraction/server/video-frame-job-http";
import { VideoFrameJobError } from "@/features/frame-extraction/video-frame-jobs";
type Context = { params: Promise<{ id: string; jobId: string }> };

export async function GET(request: Request, context: Context) {
  const { id, jobId } = await context.params;
  return videoFrameJobResponse(request, id, (store) => ({ job: store.get(id, jobId) }));
}
export async function PATCH(request: Request, context: Context) {
  const { id, jobId } = await context.params;
  return videoFrameJobResponse(request, id, async (store) => {
    const body = await readVideoJson(request) as { action?: unknown };
    if (body?.action === "cancel") return { job: store.requestCancel(id, jobId) };
    if (body?.action === "retry") return { job: store.retry(id, jobId) };
    if (body?.action === "confirm") return { job: store.confirm(id, jobId, body) };
    throw new VideoFrameJobError("INVALID_INPUT");
  });
}
