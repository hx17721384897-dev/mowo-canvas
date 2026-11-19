import { importVideo, VideoImportError } from "@/features/assets/server/video-import";
export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/videos">) {
  try {
    const { id } = await context.params;
    return Response.json({ asset: await importVideo(id, request) }, { status: 201 });
  } catch (error) {
    if (error instanceof VideoImportError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[video-import]", error);
    return Response.json({ error: "视频读取或保存失败，请确认文件完整、格式受支持且磁盘空间充足" }, { status: 400 });
  }
}
