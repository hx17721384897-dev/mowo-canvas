import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, link, mkdir, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../assets/server/schema.ts";
import { videoMediaSchema, type VideoMedia } from "../types.ts";
import { VideoTaskError, VideoTaskStore } from "./task-store.ts";

type DB = BetterSQLite3Database<typeof schema>;
export function insideVideoRoot(root: string, stored: string) {
  const path = resolve(root, stored); const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new VideoTaskError("FILE_MISSING");
  return path;
}
export function taskCache(root: string, taskId: string) {
  if (!/^[A-Za-z0-9-]{1,120}$/.test(taskId)) throw new VideoTaskError("INVALID_INPUT");
  return join(root, "cache/video-downloads", taskId);
}
export function assetCache(root: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new VideoTaskError("INVALID_INPUT");
  return join(root, "cache/video-assets", hash);
}
export async function hashVideoFile(file: string) {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  return { hash: hash.digest("hex"), size };
}
export async function syncVideoCache(db: DB, root: string, projectId: string, taskId: string) {
  const task = new VideoTaskStore(db).executionSource(projectId, taskId);
  if (!task.assetId) return;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, task.assetId)).get();
  if (!asset?.contentHash || asset.deletedAt) return;
  const from = taskCache(root, taskId), target = assetCache(root, asset.contentHash);
  await mkdir(target, { recursive: true });
  for (const name of ["cover.jpg", "preview.mp4"]) {
    try {
      // Both paths are on the same data volume. Atomic links only publish complete cache files.
      await link(join(from, name), join(target, name));
    } catch (error) { if (!["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
}
export async function importVideoTask(db: DB, root: string, projectId: string, taskId: string,
  probe: (file: string, requireAudio: boolean) => Promise<VideoMedia>) {
  const store = new VideoTaskStore(db);
  const row = store.executionSource(projectId, taskId);
  if (row.status === "completed" && row.assetId) {
    const asset = db.select().from(schema.assets).where(and(eq(schema.assets.id, row.assetId), isNull(schema.assets.deletedAt))).get();
    if (!asset?.relativePath) throw new VideoTaskError("ASSET_UNAVAILABLE");
    await access(insideVideoRoot(root, asset.relativePath)).catch(() => { throw new VideoTaskError("FILE_MISSING"); });
    await syncVideoCache(db, root, projectId, taskId).catch(() => {});
    return { task: store.get(projectId, taskId), assetId: asset.id };
  }
  if (row.status !== "ready" || !row.relativePath || !row.metadataJson) throw new VideoTaskError("INVALID_STATE");
  const source = insideVideoRoot(root, row.relativePath);
  const extension = /\.(mp4|mkv|webm)$/.exec(source)?.[1];
  if (!extension) throw new VideoTaskError("INVALID_STATE");
  const expected = videoMediaSchema.parse(JSON.parse(row.metadataJson));
  const information = await stat(source).catch(() => { throw new VideoTaskError("FILE_MISSING"); });
  if (!information.isFile() || !information.size) throw new VideoTaskError("FILE_MISSING");
  const temporary = join(root, "temp/imports", `${randomUUID()}.video`);
  await mkdir(dirname(temporary), { recursive: true });
  try {
    const hash = createHash("sha256"); let size = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } });
    await pipeline(createReadStream(source), meter, createWriteStream(temporary, { flags: "wx" }));
    if (!size || size !== information.size) throw new VideoTaskError("MEDIA_CHANGED");
    const media = videoMediaSchema.parse(await probe(temporary, expected.streams.some(s => s.codec_type === "audio")));
    const video = media.streams.find(s => s.codec_type === "video" && s.width && s.height);
    const expectedVideo = expected.streams.find(s => s.codec_type === "video" && s.width && s.height);
    if (!video || !expectedVideo || video.width !== expectedVideo.width || video.height !== expectedVideo.height
      || Math.abs(media.duration - expected.duration) > Math.max(.5, expected.duration * .01)) throw new VideoTaskError("MEDIA_CHANGED");
    const contentHash = hash.digest("hex");
    const existing = db.select().from(schema.assets).where(eq(schema.assets.contentHash, contentHash)).get();
    if (existing && (existing.deletedAt || existing.type !== "video" || !existing.relativePath)) throw new VideoTaskError("ASSET_UNAVAILABLE");
    const target = existing?.relativePath ? insideVideoRoot(root, existing.relativePath)
      : join(root, "storage/originals/videos", contentHash.slice(0, 2), `${contentHash}.${extension}`);
    await mkdir(dirname(target), { recursive: true });
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const saved = await hashVideoFile(target);
      if (saved.hash !== contentHash || saved.size !== size) throw new VideoTaskError("IMPORT_FAILED");
    }
    const assetId = db.transaction(() => {
      const current = store.executionSource(projectId, taskId);
      if (current.status === "completed" && current.assetId) return current.assetId;
      if (current.status !== "ready") throw new VideoTaskError("INVALID_STATE");
      // Recheck after asynchronous file work; project deletion and imports share this boundary.
      if (!db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId)).get()) throw new VideoTaskError("PROJECT_NOT_FOUND");
      const duplicate = db.select().from(schema.assets).where(eq(schema.assets.contentHash, contentHash)).get();
      if (duplicate && (duplicate.deletedAt || duplicate.type !== "video")) throw new VideoTaskError("ASSET_UNAVAILABLE");
      const id = duplicate?.id ?? randomUUID();
      if (!duplicate) db.insert(schema.assets).values({ id, type: "video", originalName: `${row.title}.${extension}`,
        relativePath: relative(root, target), mimeType: ({ mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm" })[extension],
        size, width: video.width, height: video.height, duration: media.duration, sourceType: "bilibili", sourceUrl: row.sourceUrl,
        contentHash, videoMetadataJson: JSON.stringify(media), createdAt: new Date() }).run();
      else if (!duplicate.videoMetadataJson) db.update(schema.assets).set({ videoMetadataJson: JSON.stringify(media) }).where(eq(schema.assets.id, id)).run();
      db.insert(schema.projectAssets).values({ projectId, assetId: id, addedAt: new Date() }).onConflictDoNothing().run();
      db.update(schema.videoDownloadTasks).set({ status: "completed", assetId: id, relativePath: duplicate?.relativePath ?? relative(root, target),
        metadataJson: JSON.stringify(media), updatedAt: new Date() }).where(eq(schema.videoDownloadTasks.id, taskId)).run();
      return id;
    }, { behavior: "immediate" });
    // Cache publication can be retried independently and never rolls back a committed original.
    await syncVideoCache(db, root, projectId, taskId).catch(() => {});
    return { task: store.get(projectId, taskId), assetId };
  } catch (error) {
    if (error instanceof VideoTaskError) throw error;
    throw new VideoTaskError((error as NodeJS.ErrnoException).code === "ENOSPC" ? "DISK_FULL" : "IMPORT_FAILED");
  } finally { await rm(temporary, { force: true }); }
}
