import { readFile } from "node:fs/promises";
import { getDownloadItemContent } from "@/features/assets/downloaders/server/download-task-service";

export async function GET(_request: Request, context: RouteContext<"/api/download-items/[id]/content">) {
  try {
    const { id } = await context.params;
    const item = await getDownloadItemContent(id);
    if (!item) return new Response("Not found", { status: 404 });
    const content = await readFile(item.path);
    return new Response(content, {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Content-Type": item.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
