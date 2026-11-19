import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import { getAssetDataPaths, resolveStoredAssetPath } from "@/features/assets/server/data-paths";
import { getAssetDatabase } from "@/features/assets/server/database";
import { assets, projectAssets } from "@/features/assets/server/schema";

const exec = promisify(execFile);
type FrameIndexMetadata = { frameCount: number; timeBaseNumerator: number; timeBaseDenominator: number;
  firstPts: number; lastPts: number; durationTicks: number | null; sourceBytes: number; sourceMtimeNs: string; contentHash: string; algorithmVersion: number };
type IndexState = { status: "running" | "failed"; error?: string };
const jobs = new Map<string, IndexState>();
const frameCache = new Map<string, Buffer>();
const pendingFrames = new Map<string, Promise<Buffer>>();
let frameCacheBytes = 0;
const maxFrameCacheBytes = 32 * 1024 * 1024;

async function sourceFor(projectId: string, assetId: string) {
  const database = await getAssetDatabase();
  const item = database.select({ asset: assets }).from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, assetId), isNull(assets.deletedAt))).get()?.asset;
  if (!item || item.type !== "video" || !item.relativePath || !item.contentHash) return null;
  return { path: resolveStoredAssetPath(item.relativePath), hash: item.contentHash };
}

function indexPath(hash: string) {
  return join(getAssetDataPaths().root, "cache", "video-editor", `${hash}-v1.sqlite`);
}

async function pythonExecutable() {
  const manifest = JSON.parse(await readFile(join(process.cwd(), "scripts", "video", "python-runtime.json"), "utf8")) as { directory: string };
  if (!/^python-[\d.]+$/.test(manifest.directory)) throw new Error("无效媒体运行时配置");
  return join(process.cwd(), "data", "video-runtime", manifest.directory, "python.exe");
}

async function completed(path: string, hash: string, source: string): Promise<FrameIndexMetadata | null> {
  const info = await stat(source, { bigint: true }).catch(() => null);
  if (!info) return null;
  let database: Database.Database | undefined;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    const row = database.prepare("SELECT json FROM metadata LIMIT 1").get() as { json: string } | undefined;
    if (!row) return null;
    const data = JSON.parse(row.json) as FrameIndexMetadata;
    return data.algorithmVersion === 1 && data.contentHash === hash && data.sourceBytes === Number(info.size)
      && data.sourceMtimeNs === info.mtimeNs.toString() && Number.isSafeInteger(data.frameCount) && data.frameCount > 0 ? data : null;
  } catch { return null; }
  finally { database?.close(); }
}

export async function frameIndexStatus(projectId: string, assetId: string) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return { status: "missing" as const };
  const metadata = await completed(indexPath(source.hash), source.hash, source.path);
  if (metadata) return { status: "ready" as const, metadata };
  return jobs.get(source.hash) ?? { status: "pending" as const };
}

/** Internal source access for frame extraction; validates project ownership and index freshness. */
export async function indexedVideoSource(projectId: string, assetId: string) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return null;
  const path = indexPath(source.hash);
  const metadata = await completed(path, source.hash, source.path);
  return metadata ? { sourcePath: source.path, indexPath: path, metadata } : null;
}

export async function ensureFrameIndex(projectId: string, assetId: string) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return { status: "missing" as const };
  const target = indexPath(source.hash);
  const metadata = await completed(target, source.hash, source.path);
  if (metadata) return { status: "ready" as const, metadata };
  if (jobs.get(source.hash)?.status === "running") return { status: "running" as const };
  jobs.set(source.hash, { status: "running" });
  void (async () => {
    try {
      await mkdir(join(getAssetDataPaths().root, "cache", "video-editor"), { recursive: true });
      await exec(await pythonExecutable(),
        ["-I", join(process.cwd(), "scripts", "video", "frame_index.py"), "--ffprobe",
          join(process.cwd(), "data", "video-runtime", "tools", "ffprobe.exe"), "--source", source.path,
          "--target", target, "--content-hash", source.hash],
        { windowsHide: true, timeout: 2 * 60 * 60 * 1000, maxBuffer: 1024 * 1024 });
      jobs.delete(source.hash);
    } catch (error) {
      jobs.set(source.hash, { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "索引失败" });
    }
  })();
  return { status: "running" as const };
}

export async function sourceFrame(projectId: string, assetId: string, ordinal: number) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) return null;
  const source = await sourceFor(projectId, assetId);
  if (!source) return null;
  const index = indexPath(source.hash);
  const metadata = await completed(index, source.hash, source.path);
  if (!metadata || ordinal >= metadata.frameCount) return null;
  const database = new Database(index, { readonly: true, fileMustExist: true });
  let row: { pts: number } | undefined;
  try { row = database.prepare("SELECT pts FROM frames WHERE ordinal=?").get(ordinal) as { pts: number } | undefined; }
  finally { database.close(); }
  if (!row) return null;
  const cacheKey = `${source.hash}:${metadata.sourceMtimeNs}:${ordinal}`;
  let image = frameCache.get(cacheKey);
  if (image) {
    frameCache.delete(cacheKey);
    frameCache.set(cacheKey, image);
  } else {
    let pending = pendingFrames.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const { stdout } = await exec(await pythonExecutable(),
          ["-I", join(process.cwd(), "scripts", "video", "frame_image.py"), "--ffmpeg",
            join(process.cwd(), "data", "video-runtime", "tools", "ffmpeg.exe"), "--source", source.path,
            "--index", index, "--ordinal", String(ordinal)],
          { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, encoding: "buffer" });
        if (stdout.length <= maxFrameCacheBytes) {
          while (frameCacheBytes + stdout.length > maxFrameCacheBytes && frameCache.size) {
            const oldest = frameCache.keys().next().value!;
            frameCacheBytes -= frameCache.get(oldest)!.length;
            frameCache.delete(oldest);
          }
          frameCache.set(cacheKey, stdout);
          frameCacheBytes += stdout.length;
        }
        return stdout;
      })();
      pendingFrames.set(cacheKey, pending);
    }
    try { image = await pending; }
    finally { if (pendingFrames.get(cacheKey) === pending) pendingFrames.delete(cacheKey); }
  }
  return { image, pts: row.pts, seconds: row.pts * metadata.timeBaseNumerator / metadata.timeBaseDenominator };
}

export async function frameTimeline(projectId: string, assetId: string) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return null;
  const path = indexPath(source.hash);
  const metadata = await completed(path, source.hash, source.path);
  if (!metadata) return null;
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = database.prepare("SELECT pts FROM frames ORDER BY ordinal").all() as { pts: number }[];
    return rows.map((row) => row.pts * metadata.timeBaseNumerator / metadata.timeBaseDenominator);
  } finally { database.close(); }
}

export async function frameAtTime(projectId: string, assetId: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const source = await sourceFor(projectId, assetId);
  if (!source) return null;
  const index = indexPath(source.hash);
  const metadata = await completed(index, source.hash, source.path);
  if (!metadata) return null;
  const ticks = Math.floor(seconds * metadata.timeBaseDenominator / metadata.timeBaseNumerator);
  const database = new Database(index, { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare("SELECT ordinal,pts FROM frames WHERE pts<=? ORDER BY pts DESC,ordinal DESC LIMIT 1")
      .get(ticks) as { ordinal: number; pts: number } | undefined;
    const frame = row ?? database.prepare("SELECT ordinal,pts FROM frames WHERE ordinal=0").get() as { ordinal: number; pts: number };
    return { ordinal: frame.ordinal, pts: frame.pts,
      seconds: frame.pts * metadata.timeBaseNumerator / metadata.timeBaseDenominator };
  } finally { database.close(); }
}

export async function clipBoundaries(projectId: string, assetId: string, startFrame: number, endFrame: number) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return null;
  const index = indexPath(source.hash);
  const metadata = await completed(index, source.hash, source.path);
  if (!metadata || !Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
    || startFrame < 0 || endFrame <= startFrame || endFrame > metadata.frameCount) return null;
  const database = new Database(index, { readonly: true, fileMustExist: true });
  try {
    const start = database.prepare("SELECT pts FROM frames WHERE ordinal=?").get(startFrame) as { pts: number } | undefined;
    const end = endFrame === metadata.frameCount ? undefined
      : database.prepare("SELECT pts FROM frames WHERE ordinal=?").get(endFrame) as { pts: number } | undefined;
    const endPts = end?.pts ?? metadata.durationTicks;
    if (!start || endPts === null || endPts === undefined || endPts <= start.pts) return null;
    return { startPts: start.pts, endPts, timeBaseNumerator: metadata.timeBaseNumerator,
      timeBaseDenominator: metadata.timeBaseDenominator,
      startSeconds: start.pts * metadata.timeBaseNumerator / metadata.timeBaseDenominator,
      endSeconds: endPts * metadata.timeBaseNumerator / metadata.timeBaseDenominator };
  } finally { database.close(); }
}

export async function frameBoundaryAt(projectId: string, assetId: string, ordinal: number) {
  const source = await sourceFor(projectId, assetId);
  if (!source) return null;
  const index = indexPath(source.hash);
  const metadata = await completed(index, source.hash, source.path);
  if (!metadata || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > metadata.frameCount) return null;
  const database = new Database(index, { readonly: true, fileMustExist: true });
  try {
    const row = ordinal === metadata.frameCount ? null
      : database.prepare("SELECT pts FROM frames WHERE ordinal=?").get(ordinal) as { pts: number } | undefined;
    const pts = row?.pts ?? (ordinal === metadata.frameCount ? metadata.durationTicks : null);
    return pts === null || pts === undefined ? null : { ordinal, pts,
      seconds: pts * metadata.timeBaseNumerator / metadata.timeBaseDenominator };
  } finally { database.close(); }
}
