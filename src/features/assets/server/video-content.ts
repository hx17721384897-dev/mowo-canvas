import "server-only";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "./database";
import { getAssetDataPaths, resolveStoredAssetPath } from "./data-paths";
import { assets } from "./schema";
import { assetCache } from "@/features/video-downloads/server/import-video";
import { videoMediaSchema } from "@/features/video-downloads/types";
import { checkVideoLocalRequest } from "@/features/video-downloads/server/http";
import { VideoTaskError } from "@/features/video-downloads/server/task-store";
import { serveMedia } from "./serve-media";

export async function videoAssetContent(request: Request, assetId: string, kind: "preview" | "cover", head = false) {
  try {
    checkVideoLocalRequest(request);
    const db = await getAssetDatabase();
    const asset = db.select().from(assets).where(and(eq(assets.id, assetId), isNull(assets.deletedAt))).get();
    if (!asset || asset.type !== "video" || !asset.relativePath) return new Response(null, { status: 404 });
    const cached = asset.contentHash ? join(assetCache(getAssetDataPaths().root, asset.contentHash), kind === "cover" ? "cover.jpg" : "preview.mp4") : null;
    if (cached && await access(cached).then(() => true, () => false)) return await serveMedia(request, { path: cached, name: kind === "cover" ? "cover.jpg" : "preview.mp4", mimeType: kind === "cover" ? "image/jpeg" : "video/mp4" }, head);
    if (kind === "cover") return new Response(null, { status: 404 });
    const media = asset.videoMetadataJson ? videoMediaSchema.safeParse(JSON.parse(asset.videoMetadataJson)) : null;
    if (media && (!media.success || !media.data.browserCandidate)) throw new VideoTaskError("PREVIEW_FAILED");
    return await serveMedia(request, { path: resolveStoredAssetPath(asset.relativePath), name: asset.originalName, mimeType: asset.mimeType ?? "video/mp4" }, head);
  } catch (error) {
    const safe = error instanceof VideoTaskError ? error : new VideoTaskError("FILE_MISSING");
    return Response.json({ code: safe.code, error: safe.message }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
