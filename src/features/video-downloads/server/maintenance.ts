import { lstat, realpath, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../assets/server/schema.ts";
import { VideoTaskError, VideoTaskStore } from "./task-store.ts";
import { assetCache, hashVideoFile, insideVideoRoot, syncVideoCache, taskCache } from "./import-video.ts";

type DB = BetterSQLite3Database<typeof schema>;
const below = (root: string, path: string) => { const value = relative(root, path); return !!value && !value.startsWith("..") && !isAbsolute(value); };
async function checkedTree(root: string, target: string): Promise<boolean> {
  const absolute = resolve(target);
  if (!below(resolve(root), absolute)) throw new VideoTaskError("CLEANUP_FAILED");
  const info = await lstat(absolute).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!info) return false;
  if (info.isSymbolicLink() || !info.isDirectory() || !below(await realpath(root), await realpath(absolute))) throw new VideoTaskError("CLEANUP_FAILED");
  const scan = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new VideoTaskError("CLEANUP_FAILED");
      if (entry.isDirectory()) await scan(join(directory, entry.name));
    }
  };
  await scan(absolute); return true;
}

// Caller pauses scheduling and rejects operations for this task until this finishes.
export async function cleanupVideoTask(db: DB, root: string, projectId: string, taskId: string) {
  const store = new VideoTaskStore(db); const row = store.executionSource(projectId, taskId);
  if (!["failed", "cancelled", "completed"].includes(row.status) || row.previewStatus === "generating") throw new VideoTaskError("INVALID_STATE");
  const cache = taskCache(root, taskId); // Validates ID; never delete a path received from the client or task.relativePath.
  if (row.status === "completed") {
    const asset = row.assetId && db.select().from(schema.assets).where(eq(schema.assets.id, row.assetId)).get();
    if (!asset || asset.deletedAt || !asset.relativePath || !asset.contentHash) throw new VideoTaskError("ASSET_UNAVAILABLE");
    const saved = await hashVideoFile(insideVideoRoot(root, asset.relativePath)).catch(() => { throw new VideoTaskError("FILE_MISSING"); });
    if (saved.hash !== asset.contentHash || saved.size !== asset.size) throw new VideoTaskError("MEDIA_CHANGED");
    await syncVideoCache(db, root, projectId, taskId);
  }
  const targets = [join(root, "temp/video-downloads", taskId), cache];
  const existing: string[] = [];
  // Validate every absolute destination before the first recursive removal.
  for (const target of targets) if (await checkedTree(root, target)) existing.push(resolve(target));
  for (const target of existing) await rm(target, { recursive: true, force: true });
  if (row.status !== "completed") db.update(schema.videoDownloadTasks).set({ relativePath: null, metadataJson: null, recoveryMode: null, updatedAt: new Date() })
    .where(and(eq(schema.videoDownloadTasks.id, taskId), eq(schema.videoDownloadTasks.projectId, projectId))).run();
  return { task: store.get(projectId, taskId), cleanedDirectories: existing.length };
}

// Startup only, after the executor guardian has stopped the previous process tree.
export async function reconcileVideoFiles(db: DB, root: string) {
  const rows = db.select().from(schema.videoDownloadTasks).where(inArray(schema.videoDownloadTasks.status, ["ready", "completed"])).all();
  for (const row of rows) {
    let present = false;
    try { present = !!row.relativePath && await stat(insideVideoRoot(root, row.relativePath)).then(file => file.isFile() && file.size > 0, () => false); } catch { /* Invalid stored paths are missing, never followed. */ }
    if (!present) {
      db.update(schema.videoDownloadTasks).set({ status: row.status === "ready" ? "failed" : "completed", errorCode: row.status === "ready" ? "FILE_MISSING" : "ASSET_FILE_MISSING", previewStatus: "failed", updatedAt: new Date() })
        .where(eq(schema.videoDownloadTasks.id, row.id)).run();
      continue;
    }
    if (["FILE_MISSING", "ASSET_FILE_MISSING"].includes(row.errorCode ?? "")) db.update(schema.videoDownloadTasks).set({ errorCode: null }).where(eq(schema.videoDownloadTasks.id, row.id)).run();
    if (row.previewStatus === "ready") {
      const preview = join(taskCache(root, row.id), "preview.mp4");
      // Completed tasks may have intentionally removed their task cache; asset cache is independent.
      let available = await stat(preview).then(file => file.isFile() && file.size > 0, () => false);
      if (!available && row.assetId) {
        const asset = db.select().from(schema.assets).where(eq(schema.assets.id, row.assetId)).get();
        if (asset?.contentHash && /^[a-f0-9]{64}$/.test(asset.contentHash)) available = await stat(join(assetCache(root, asset.contentHash), "preview.mp4")).then(file => file.isFile() && file.size > 0, () => false);
      }
      if (!available) db.update(schema.videoDownloadTasks).set({ previewStatus: "failed", errorCode: "PREVIEW_FAILED" }).where(eq(schema.videoDownloadTasks.id, row.id)).run();
    }
  }
}
