import "server-only";

import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { getAssetDataPaths, resolveStoredAssetPath } from "@/features/assets/server/data-paths";
import { assets, projectAssets } from "@/features/assets/server/schema";
import { assetCache } from "@/features/video-downloads/server/import-video";
import { videoMediaSchema } from "@/features/video-downloads/types";
import { invokeEngine } from "../../../../scripts/video/engine-client.mjs";

const jobs = new Map<string, { status: "running" | "failed"; error?: string }>();
async function sourceFor(projectId: string, assetId: string) {
  const database = await getAssetDatabase();
  const asset = database.select({ asset: assets }).from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, assetId), isNull(assets.deletedAt))).get()?.asset;
  return asset?.type === "video" && asset.sourceType !== "video-clip" && asset.relativePath && asset.contentHash ? asset : null;
}

export async function previewStatus(projectId: string, assetId: string) {
  const asset = await sourceFor(projectId, assetId);
  if (!asset) return { status: "missing" as const };
  const media = asset.videoMetadataJson ? videoMediaSchema.safeParse(JSON.parse(asset.videoMetadataJson)) : null;
  if (media?.success && media.data.browserCandidate) return { status: "ready" as const, url: `/api/assets/${asset.id}/preview` };
  const cache = join(assetCache(getAssetDataPaths().root, asset.contentHash!), "preview.mp4");
  if (await access(cache).then(() => true, () => false)) return { status: "ready" as const, url: `/api/assets/${asset.id}/preview` };
  return jobs.get(asset.contentHash!) ?? { status: "pending" as const };
}

export async function ensurePreview(projectId: string, assetId: string) {
  const asset = await sourceFor(projectId, assetId);
  if (!asset) return { status: "missing" as const };
  const status = await previewStatus(projectId, assetId);
  if (status.status === "ready" || status.status === "running") return status;
  jobs.set(asset.contentHash!, { status: "running" });
  void (async () => {
    try {
      const root = getAssetDataPaths().root;
      const directory = assetCache(root, asset.contentHash!);
      await mkdir(directory, { recursive: true });
      await invokeEngine({ action: "preview", file: resolveStoredAssetPath(asset.relativePath!),
        target: join(directory, "preview.mp4"),
        ffmpeg: join(process.cwd(), "data", "video-runtime", "tools", "ffmpeg.exe"),
        ffprobe: join(process.cwd(), "data", "video-runtime", "tools", "ffprobe.exe") },
      { timeoutMs: 3600000, managed: { directory, root: join(root, "runtime", "video-editor-control") } });
      jobs.delete(asset.contentHash!);
    } catch (error) {
      jobs.set(asset.contentHash!, { status: "failed", error: error instanceof Error ? error.message.slice(0, 160) : "兼容预览生成失败" });
    }
  })();
  return { status: "running" as const };
}
