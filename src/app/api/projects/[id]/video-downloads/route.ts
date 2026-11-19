import { getVideoTaskStore } from "@/features/video-downloads/server/task-service";
import { readVideoJson, videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";
import { VideoTaskError } from "@/features/video-downloads/server/task-store";
import { z } from "zod";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return videoTaskResponse(request, async () => {
    const { id } = await context.params;
    return { tasks: (await getVideoTaskStore()).list(id) };
  });
}
export async function POST(request: Request, context: Context) {
  return videoTaskResponse(request, async () => {
    const { id } = await context.params;
    const body = await readVideoJson(request);
    const input = z.object({ resolveId: z.string().uuid(), choiceId: z.string().min(1).max(80) }).strict().safeParse(body);
    if (!input.success) throw new VideoTaskError("INVALID_INPUT");
    return callVideoService("create", { projectId: id, ...input.data });
  }, 201);
}
