import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { isAbsolute, join, relative, resolve } from "node:path";
import { stat } from "node:fs/promises";
import * as schema from "../../assets/server/schema.ts";
import { validateVideoFrameRange } from "../video-frame-policy.ts";
import { VideoFrameRuntimeError } from "./video-frame-runtime.ts";

export function videoFramePath(root: string, path: string) {
  const target = resolve(root, path), inside = relative(resolve(root), target);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new VideoFrameRuntimeError("INVALID_SOURCE_PATH");
  return target;
}

/** Shared by Next and the existing independent coordinator. */
export function resolveVideoFrameSource(db: BetterSQLite3Database<typeof schema>, root: string, projectId: string, assetId: string) {
  const { assets, projectAssets, videoClips } = schema;
  const asset = db.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(assets.id, assetId), isNull(assets.deletedAt))).get()?.asset;
  if (!asset || asset.type !== "video") throw new VideoFrameRuntimeError("VIDEO_UNAVAILABLE");
  const clip = db.select().from(videoClips).where(and(eq(videoClips.id, assetId), eq(videoClips.projectId, projectId))).get();
  const duration = clip ? (clip.endPts - clip.startPts) * clip.timeBaseNumerator / clip.timeBaseDenominator : asset.duration;
  if (duration === null) throw new VideoFrameRuntimeError("INVALID_DURATION");
  const issue = validateVideoFrameRange(duration, clip ? null : asset.size)[0];
  if (issue) throw new VideoFrameRuntimeError(issue);
  if (!clip && asset.size === null) throw new VideoFrameRuntimeError("INVALID_SIZE");
  const sourceAssetId = clip?.sourceAssetId ?? assetId;
  const source = db.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(assets.id, sourceAssetId), isNull(assets.deletedAt))).get()?.asset;
  if (!source?.relativePath || !source.contentHash || !/^[a-f0-9]{64}$/.test(source.contentHash)) throw new VideoFrameRuntimeError("VIDEO_UNAVAILABLE");
  return { assetId, sourceAssetId, name: asset.originalName, contentHash: source.contentHash,
    sourcePath: videoFramePath(root, source.relativePath),
    indexPath: join(root, "cache/video-editor", `${source.contentHash}-v1.sqlite`),
    startFrame: clip?.startFrame ?? 0, endFrame: clip?.endFrame };
}

export async function readyVideoFrameIndex(source: ReturnType<typeof resolveVideoFrameSource>) {
  const info = await stat(source.sourcePath, { bigint: true }).catch(() => null);
  if (!info) throw new VideoFrameRuntimeError("VIDEO_UNAVAILABLE");
  let db: Database.Database | undefined;
  try {
    db = new Database(source.indexPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT json FROM metadata LIMIT 1").get() as { json: string } | undefined;
    const metadata = JSON.parse(row?.json ?? "null") as { algorithmVersion: number; contentHash: string; sourceBytes: number; sourceMtimeNs: string; frameCount: number } | null;
    return metadata?.algorithmVersion === 1 && metadata.contentHash === source.contentHash
      && metadata.sourceBytes === Number(info.size) && metadata.sourceMtimeNs === String(info.mtimeNs)
      && Number.isSafeInteger(metadata.frameCount) && metadata.frameCount > 0 ? metadata : null;
  } catch { return null; }
  finally { db?.close(); }
}
