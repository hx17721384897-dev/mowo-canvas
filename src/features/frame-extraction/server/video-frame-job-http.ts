import "server-only";
import { z } from "zod";
import { getAssetDatabase } from "@/features/assets/server/database";
import { checkVideoLocalRequest, readVideoJson } from "@/features/video-downloads/server/http";
import { VideoTaskError } from "@/features/video-downloads/server/task-store";
import { VideoFrameJobError } from "../video-frame-jobs";
import { VideoFrameJobStore } from "./video-frame-job-store";

export async function videoFrameJobResponse(request: Request, projectId: string,
  action: (store: VideoFrameJobStore) => unknown | Promise<unknown>, status = 200) {
  try {
    checkVideoLocalRequest(request);
    if (!projectId || projectId.length > 120) throw new VideoFrameJobError("INVALID_INPUT");
    return Response.json(await action(new VideoFrameJobStore(await getAssetDatabase())), { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error instanceof VideoFrameJobError || error instanceof VideoTaskError ? error
      : new VideoFrameJobError(error instanceof z.ZodError ? "INVALID_INPUT" : "INTERNAL_ERROR", error instanceof z.ZodError ? 400 : 500);
    return Response.json({ code: failure.code, error: failure.message }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
export { readVideoJson };
