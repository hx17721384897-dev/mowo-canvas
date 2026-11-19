import { exportVideoClip } from "@/features/video-editor/server/export-clip";

export async function GET(request: Request,
  context: RouteContext<"/api/projects/[id]/video-clips/[clipId]/export">) {
  const { id, clipId } = await context.params;
  try {
    return await exportVideoClip(id, clipId, request.signal);
  } catch (error) {
    console.error("Video clip export failed", { projectId: id, clipId, error });
    return new Response("视频片段导出失败，请重试", { status: 500,
      headers: { "Cache-Control": "no-store" } });
  }
}
