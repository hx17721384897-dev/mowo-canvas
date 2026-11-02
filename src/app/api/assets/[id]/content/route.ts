import { readFile } from "node:fs/promises";
import { getAssetContent } from "@/features/assets/server/asset-catalog";

export async function GET(_request: Request, context: RouteContext<"/api/assets/[id]/content">) {
  try {
    const { id } = await context.params;
    const asset = await getAssetContent(id);
    if (!asset) return new Response("Not found", { status: 404 });

    const content = await readFile(asset.path);
    return new Response(content, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Content-Type": asset.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
