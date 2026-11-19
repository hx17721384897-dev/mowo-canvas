import { getVideoTaskStore } from "@/features/video-downloads/server/task-service";
import { videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";

type Context = { params: Promise<{ id: string; taskId: string }> };

export async function GET(request: Request, context: Context) {
  return videoTaskResponse(request, async () => {
    const { id, taskId } = await context.params;
    return { task: (await getVideoTaskStore()).get(id, taskId) };
  });
}
export async function DELETE(request: Request, context: Context) {
  return videoTaskResponse(request, async () => {
    const { id, taskId } = await context.params;
    return callVideoService("cancel", { projectId: id, taskId });
  });
}
