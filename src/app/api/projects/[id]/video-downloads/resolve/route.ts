import { z } from "zod";
import { readVideoJson, videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";
import { VideoTaskError } from "@/features/video-downloads/server/task-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return videoTaskResponse(request, async () => {
    const { id } = await context.params;
    const input = z.object({ url: z.string().trim().min(1).max(2000) }).strict().safeParse(await readVideoJson(request));
    if (!input.success) throw new VideoTaskError("INVALID_INPUT");
    return callVideoService("resolve", { projectId: id, url: input.data.url });
  });
}
