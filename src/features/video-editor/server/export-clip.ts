import "server-only";

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { getAssetDataPaths, resolveStoredAssetPath } from "@/features/assets/server/data-paths";
import { assets, videoClips } from "@/features/assets/server/schema";

function renderClip(source: string, target: string, startFrame: number, endFrame: number,
  startSeconds: number, endSeconds: number, signal: AbortSignal) {
  const ffmpeg = join(process.cwd(), "data", "video-runtime", "tools", "ffmpeg.exe");
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS,format=yuv420p`,
    "-af", `atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS`,
    "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4", target];
  return new Promise<void>((resolve, reject) => {
    const process = spawn(ffmpeg, args, { windowsHide: true, signal });
    let error = "";
    process.stderr.on("data", (chunk: Buffer) => { error = (error + chunk.toString()).slice(-2000); });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(`视频片段导出失败 (${code}): ${error}`)));
  });
}

export async function exportVideoClip(projectId: string, clipId: string, signal: AbortSignal): Promise<Response> {
  const database = await getAssetDatabase();
  const record = database.select({ clip: videoClips, source: assets })
    .from(videoClips).innerJoin(assets, eq(videoClips.sourceAssetId, assets.id))
    .where(and(eq(videoClips.projectId, projectId), eq(videoClips.id, clipId), isNull(assets.deletedAt))).get();
  const sourceRelativePath = record?.source.relativePath;
  if (!record || !sourceRelativePath) return new Response("片段不存在", { status: 404 });
  const name = database.select({ name: assets.originalName }).from(assets)
    .where(and(eq(assets.id, clipId), isNull(assets.deletedAt))).get()?.name;
  if (!name) return new Response("片段不存在", { status: 404 });

  const { clip } = record;
  const sourcePath = resolveStoredAssetPath(sourceRelativePath);
  const startSeconds = clip.startPts * clip.timeBaseNumerator / clip.timeBaseDenominator;
  const endSeconds = clip.endPts * clip.timeBaseNumerator / clip.timeBaseDenominator;
  if (!Number.isSafeInteger(clip.startFrame) || !Number.isSafeInteger(clip.endFrame) || clip.endFrame <= clip.startFrame
    || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds)
    return new Response("片段范围无效", { status: 409 });

  const tempRoot = join(getAssetDataPaths().root, "temp");
  await mkdir(tempRoot, { recursive: true });
  const directory = await mkdtemp(join(tempRoot, "video-clip-export-"));
  const output = join(directory, "clip.mp4");
  try {
    await renderClip(sourcePath, output, clip.startFrame, clip.endFrame,
      startSeconds, endSeconds, signal);
    const { size } = await stat(output);
    if (!size) throw new Error("视频片段导出结果为空");
    const file = createReadStream(output);
    file.once("close", () => { void rm(directory, { recursive: true, force: true }); });
    const filename = `${name.replace(/\.mp4$/i, "")}.mp4`;
    return new Response(Readable.toWeb(file) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": "video/mp4", "Content-Length": String(size), "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
