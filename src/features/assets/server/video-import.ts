import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, statfs } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { readVideoMetadata } from "./video-metadata";
import { ensureAssetDataPaths } from "./data-paths";
import { getAssetDatabase } from "./database";
import { assets, projects, projectAssets } from "./schema";
import { listProjectAssets } from "./asset-catalog";
import { invokeEngine } from "../../../../scripts/video/engine-client.mjs";
import { videoMediaSchema } from "@/features/video-downloads/types";

export class VideoImportError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_VIDEO") { super(message); }
}
export async function importVideo(projectId: string, request: Request) {
  const database = await getAssetDatabase();
  if (!database.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw new VideoImportError("项目不存在", 404);
  const name = new URL(request.url).searchParams.get("name");
  if (!name || name.length > 255 || /[\/\\\x00-\x1f]/.test(name) || !/\.(mp4|mov|m4v)$/i.test(name)) throw new VideoImportError("请选择 MP4、M4V 或 MOV 视频");
  if (!request.body) throw new VideoImportError("没有收到视频文件");
  const paths = await ensureAssetDataPaths();
  const claimedBytes = Number(request.headers.get("content-length"));
  const space = await statfs(paths.root);
  const receiveLimit = Math.max(0, space.bavail * space.bsize - 64 * 1024 * 1024);
  if (Number.isFinite(claimedBytes) && claimedBytes > receiveLimit)
    throw new VideoImportError("磁盘剩余空间不足，无法接收此视频", 507, "INSUFFICIENT_STORAGE");
  const temporary = join(paths.tempImports, `${randomUUID()}.video`);
  const file = await open(temporary, "wx");
  const reader = request.body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  try {
    try {
      while (true) {
        if (request.signal.aborted) throw new VideoImportError("视频接收已取消", 499, "UPLOAD_CANCELLED");
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > receiveLimit) throw new VideoImportError("磁盘剩余空间不足，无法接收此视频", 507, "INSUFFICIENT_STORAGE");
        hash.update(chunk.value);
        let offset = 0;
        while (offset < chunk.value.length) {
          const written = await file.write(chunk.value, offset, chunk.value.length - offset);
          if (!written.bytesWritten) throw new Error("视频写入失败");
          offset += written.bytesWritten;
        }
      }
      await file.sync();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close(); }
    const metadata = await readVideoMetadata(temporary);
    let videoMetadataJson: string | null = null;
    try {
      const events = await invokeEngine({ action: "probe", file: temporary,
        ffprobe: join(process.cwd(), "data", "video-runtime", "tools", "ffprobe.exe") }, { timeoutMs: 60000, managed: false });
      const parsed = videoMediaSchema.safeParse(events.find((event) => event.event === "probed"));
      if (parsed.success) videoMetadataJson = JSON.stringify(parsed.data);
    } catch { /* The container parser still permits local import when the optional media runtime is unavailable. */ }
    const contentHash = hash.digest("hex");
    const existing = database.select().from(assets).where(eq(assets.contentHash, contentHash)).get();
    if (existing?.deletedAt) throw new VideoImportError("相同视频在回收站中，请先恢复");
    const assetId = existing?.id ?? randomUUID();
    if (!existing) {
      const target = join(paths.root, "storage", "originals", "videos", contentHash.slice(0, 2), `${contentHash}${/\.mov$/i.test(name) ? ".mov" : ".mp4"}`);
      await mkdir(dirname(target), { recursive: true });
      await rename(temporary, target);
      database.insert(assets).values({ id: assetId, type: "video", originalName: name,
        relativePath: relative(paths.root, target), mimeType: /\.mov$/i.test(name) ? "video/quicktime" : "video/mp4",
        size, ...metadata, sourceType: "local", contentHash, videoMetadataJson, createdAt: new Date() }).onConflictDoNothing().run();
    }
    const stored = database.select({ id: assets.id }).from(assets).where(and(eq(assets.contentHash, contentHash), isNull(assets.deletedAt))).get();
    if (!stored) throw new Error("视频资产写入失败");
    database.insert(projectAssets).values({ projectId, assetId: stored.id, addedAt: new Date() }).onConflictDoNothing().run();
    return (await listProjectAssets(projectId)).find((asset) => asset.id === stored.id)!;
  } finally { await rm(temporary, { force: true }); }
}
