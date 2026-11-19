import { callVideoService } from "@/features/video-downloads/server/service-client";
import { videoTaskResponse } from "@/features/video-downloads/server/http";

export async function POST(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  return videoTaskResponse(request, async () => {
    const { id, taskId } = await context.params;
    return callVideoService("retry", { projectId: id, taskId });
  });
}
