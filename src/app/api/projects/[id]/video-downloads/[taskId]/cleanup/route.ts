import { videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";

export async function POST(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  return videoTaskResponse(request, async () => {
    const { id, taskId } = await context.params;
    return callVideoService("cleanup", { projectId: id, taskId });
  });
}
