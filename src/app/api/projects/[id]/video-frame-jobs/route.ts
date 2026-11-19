import { readVideoJson, videoFrameJobResponse } from "@/features/frame-extraction/server/video-frame-job-http";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return videoFrameJobResponse(request, id, async (store) => ({ job: store.create(id, await readVideoJson(request)) }), 202);
}
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const nodeId = new URL(request.url).searchParams.get("nodeId") ?? undefined;
  return videoFrameJobResponse(request, id, (store) => ({ jobs: store.list(id, nodeId) }));
}
