import { z } from "zod";
import { readVideoJson, videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";
import { VideoTaskError } from "@/features/video-downloads/server/task-store";

export async function POST(request: Request) {
  return videoTaskResponse(request, async () => {
    const input = z.object({ action: z.enum(["status", "generate", "poll", "logout"]) }).strict().safeParse(await readVideoJson(request));
    if (!input.success) throw new VideoTaskError("INVALID_INPUT");
    return callVideoService("auth", input.data);
  });
}
