import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getDraftFrameContent } from "@/features/frame-extraction/server/frame-extraction-service";

export async function GET(_request: Request, context: RouteContext<"/api/frame-extraction/tasks/[taskId]/frames/[frameId]">) {
  const { taskId, frameId } = await context.params;
  try {
    const content = await getDraftFrameContent(taskId, frameId);
    if (!content) return Response.json({ error: "帧不存在" }, { status: 404 });
    return new Response(Readable.toWeb(createReadStream(content.path)) as ReadableStream, {
      headers: { "Content-Type": "image/png", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(content.name)}`, "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "帧文件不可用" }, { status: 404 });
  }
}
