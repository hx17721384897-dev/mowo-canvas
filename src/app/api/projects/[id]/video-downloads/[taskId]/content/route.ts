import { join } from "node:path";
import { getVideoTaskStore } from "@/features/video-downloads/server/task-service";
import { checkVideoLocalRequest } from "@/features/video-downloads/server/http";
import { VideoTaskError } from "@/features/video-downloads/server/task-store";
import { getAssetDataPaths } from "@/features/assets/server/data-paths";
import { insideVideoRoot, taskCache } from "@/features/video-downloads/server/import-video";
import { serveMedia } from "@/features/assets/server/serve-media";

type Context = { params: Promise<{ id: string; taskId: string }> };
async function content(request: Request, context: Context, head = false) {
  try {
    checkVideoLocalRequest(request);
    const { id, taskId } = await context.params;
    const row = (await getVideoTaskStore()).executionSource(id, taskId);
    if (!["ready", "completed"].includes(row.status)) throw new VideoTaskError("INVALID_STATE");
    const { root } = getAssetDataPaths();
    const kind = new URL(request.url).searchParams.get("kind") ?? "source";
    if (!["source", "preview", "cover"].includes(kind)) throw new VideoTaskError("INVALID_INPUT");
    if (kind === "preview" && row.previewStatus !== "ready") throw new VideoTaskError("PREVIEW_FAILED");
    if (kind === "source" && !row.relativePath) throw new VideoTaskError("FILE_MISSING");
    const path = kind === "source" ? insideVideoRoot(root, row.relativePath!) : join(taskCache(root, taskId), kind === "cover" ? "cover.jpg" : "preview.mp4");
    const extension = path.split(".").at(-1)!;
    return await serveMedia(request, { path, name: kind === "cover" ? "cover.jpg" : `${row.title}.${extension}`,
      mimeType: ({ mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", jpg: "image/jpeg" })[extension] ?? "application/octet-stream" }, head);
  } catch (error) {
    const safe = error instanceof VideoTaskError ? error : new VideoTaskError("FILE_MISSING");
    return Response.json({ code: safe.code, error: safe.message }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
export async function GET(request: Request, context: Context) { return content(request, context); }
export async function HEAD(request: Request, context: Context) { return content(request, context, true); }
