import { videoTaskResponse } from "@/features/video-downloads/server/http";
import { callVideoService } from "@/features/video-downloads/server/service-client";
import { listProjectAssets } from "@/features/assets/server/asset-catalog";

export async function POST(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  return videoTaskResponse(request, async () => {
    const { id, taskId } = await context.params;
    const result = await callVideoService("import", { projectId: id, taskId });
    const asset = (await listProjectAssets(id)).find(asset => asset.id === result.assetId);
    return { ...result, asset };
  });
}
