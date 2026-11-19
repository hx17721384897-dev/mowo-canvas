import { videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";

export async function GET(request: Request) {
  return videoTaskResponse(request, () => callVideoService("storage"));
}
