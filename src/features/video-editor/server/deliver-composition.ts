import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { ensureAssetDataPaths, resolveStoredAssetPath } from "@/features/assets/server/data-paths";
import { listProjectAssets } from "@/features/assets/server/asset-catalog";
import { assets, projectAssets, videoCuttingOutputs, videoCuttingProjects } from "@/features/assets/server/schema";
import { getCanvasDocument, saveCanvasDocument } from "@/features/projects/server/project-service";
import { validateCanvasDocument } from "@/features/projects/canvas-document";
import type { CanvasModuleNode } from "@/features/canvas/types";
import type { AssetSummary } from "@/features/assets/types";
import { validCuttingClips, type CuttingClip } from "../cutting-model";
import { clipBoundaries, frameIndexStatus } from "./frame-index";
import { renderComposition, type RenderSegment } from "./render-composition";

export class CompositionDeliveryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

async function prepare(projectId: string, sourceAssetId: string, expectedRevision: number) {
  const database = await getAssetDatabase();
  const source = database.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, sourceAssetId), isNull(assets.deletedAt))).get()?.asset;
  if (!source || source.type !== "video" || source.sourceType === "video-clip" || !source.relativePath || !source.contentHash)
    throw new CompositionDeliveryError("原视频不属于此项目", 404);
  const index = await frameIndexStatus(projectId, sourceAssetId);
  if (index.status !== "ready") throw new CompositionDeliveryError("源帧索引尚未就绪");
  const project = database.select().from(videoCuttingProjects).where(and(eq(videoCuttingProjects.projectId, projectId),
    eq(videoCuttingProjects.sourceAssetId, sourceAssetId))).get();
  if (project && project.sourceHash !== source.contentHash)
    throw new CompositionDeliveryError("原片已变化，请重新打开剪辑工程");
  const revision = project?.revision ?? 0;
  if (revision !== expectedRevision) throw new CompositionDeliveryError("剪辑工程已变化，请等待保存并重试");
  let clips: unknown;
  try { clips = project ? JSON.parse(project.clipsJson) : [{ id: sourceAssetId, sourceAssetId, inFrame: 0, outFrame: index.metadata.frameCount }]; }
  catch { throw new CompositionDeliveryError("剪辑工程无法读取"); }
  if (!validCuttingClips(clips, sourceAssetId, index.metadata.frameCount)) throw new CompositionDeliveryError("剪辑工程片段无效");
  if (!clips.length) throw new CompositionDeliveryError("成片为空，请先加入片段");
  const segments = await Promise.all(clips.map(async (clip) => {
    const boundary = await clipBoundaries(projectId, sourceAssetId, clip.inFrame, clip.outFrame);
    if (!boundary) throw new CompositionDeliveryError("片段边界无法读取");
    return { inFrame: clip.inFrame, outFrame: clip.outFrame,
      startSeconds: boundary.startSeconds, endSeconds: boundary.endSeconds } satisfies RenderSegment;
  }));
  return { database, source, projectId, sourceAssetId, revision, clips: clips as CuttingClip[], segments,
    sourcePath: resolveStoredAssetPath(source.relativePath) };
}

function currentRevision(context: Awaited<ReturnType<typeof prepare>>) {
  const row = context.database.select({ revision: videoCuttingProjects.revision }).from(videoCuttingProjects)
    .where(and(eq(videoCuttingProjects.projectId, context.projectId),
      eq(videoCuttingProjects.sourceAssetId, context.sourceAssetId))).get();
  return row?.revision ?? 0;
}

async function temporaryOutput() {
  const paths = await ensureAssetDataPaths();
  const parent = join(paths.root, "temp");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "video-cutting-"));
  if (!resolve(directory).startsWith(resolve(parent) + sep)) throw new Error("临时目录无效");
  return { paths, directory, output: join(directory, "composition.mp4") };
}

async function contentHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function filename(name: string) {
  const stem = basename(name, extname(name)).replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120) || "视频";
  return `${stem} · 成片.mp4`;
}

async function placeOnCanvas(projectId: string, asset: AssetSummary) {
  const document = await getCanvasDocument(projectId);
  if (!document) throw new CompositionDeliveryError("画布不存在，成片已保存到素材库", 404);
  if (document.nodes.some((node) => node.type === "module" && node.data.assetId === asset.id)) return;
  const previous = document.nodes.filter((node) => !node.parentId).at(-1);
  const node: CanvasModuleNode = {
    id: `asset-${asset.id}-${randomUUID()}`, type: "module",
    position: { x: (previous?.position.x ?? 100) + (previous ? 48 : 0),
      y: (previous?.position.y ?? 100) + (previous ? 48 : 0) },
    style: { width: 320, height: Math.max(120, Math.min(480, Math.round(320 * (asset.height ?? 180) / (asset.width ?? 320)))) },
    data: { moduleType: "video", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined,
      title: asset.name, detail: `${asset.width} × ${asset.height} px · ${asset.duration?.toFixed(1)} 秒 · 资产库` },
  };
  const next = { ...document, nodes: [...document.nodes, node] };
  validateCanvasDocument(next);
  await saveCanvasDocument(projectId, next);
}

async function ensurePlaced(projectId: string, asset: AssetSummary) {
  try { await placeOnCanvas(projectId, asset); }
  catch { throw new CompositionDeliveryError("成片已保存到素材库，但放入画布失败；可从素材库拖入", 500); }
}

function fileResponse(path: string, size: number, name: string, cleanup?: () => void) {
  const file = createReadStream(path);
  file.once("close", cleanup ?? (() => {}));
  return new Response(Readable.toWeb(file) as ReadableStream<Uint8Array>, { headers: {
    "Content-Type": "video/mp4", "Content-Length": String(size), "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function downloadComposition(projectId: string, sourceAssetId: string, revision: number, signal: AbortSignal) {
  const context = await prepare(projectId, sourceAssetId, revision);
  const existing = context.database.select({ asset: assets }).from(videoCuttingOutputs).innerJoin(assets, eq(videoCuttingOutputs.assetId, assets.id))
    .where(and(eq(videoCuttingOutputs.projectId, projectId), eq(videoCuttingOutputs.sourceAssetId, sourceAssetId),
      eq(videoCuttingOutputs.projectRevision, revision), isNull(assets.deletedAt))).get()?.asset;
  if (existing?.relativePath && existing.size) return fileResponse(resolveStoredAssetPath(existing.relativePath), existing.size, filename(context.source.originalName));
  const temp = await temporaryOutput();
  try {
    const result = await renderComposition(context.sourcePath, temp.output, context.segments, signal);
    if (currentRevision(context) !== revision) throw new CompositionDeliveryError("剪辑工程已变化，请重新导出");
    return fileResponse(temp.output, result.size, filename(context.source.originalName),
      () => { void rm(temp.directory, { recursive: true, force: true }); });
  } catch (error) { await rm(temp.directory, { recursive: true, force: true }); throw error; }
}

export async function saveComposition(projectId: string, sourceAssetId: string, revision: number, signal: AbortSignal) {
  const context = await prepare(projectId, sourceAssetId, revision);
  const outputWhere = and(eq(videoCuttingOutputs.projectId, projectId), eq(videoCuttingOutputs.sourceAssetId, sourceAssetId),
    eq(videoCuttingOutputs.projectRevision, revision));
  const saved = context.database.select({ assetId: videoCuttingOutputs.assetId }).from(videoCuttingOutputs).where(outputWhere).get();
  if (saved) {
    const asset = (await listProjectAssets(projectId)).find((item) => item.id === saved.assetId);
    if (!asset) throw new CompositionDeliveryError("已保存成片无法读取");
    await ensurePlaced(projectId, asset);
    return { asset, revision };
  }
  const temp = await temporaryOutput();
  let target: string | null = null, targetCreated = false, hash: string | null = null;
  try {
    const rendered = await renderComposition(context.sourcePath, temp.output, context.segments, signal);
    if (currentRevision(context) !== revision) throw new CompositionDeliveryError("剪辑工程已变化，请重新保存");
    hash = await contentHash(temp.output);
    target = join(temp.paths.root, "storage", "derived", "videos", hash.slice(0, 2), `${hash}.mp4`);
    await mkdir(dirname(target), { recursive: true });
    if (!await stat(target).then(() => true, () => false)) { await rename(temp.output, target); targetCreated = true; }
    const assetId = context.database.transaction((database) => {
      const latest = database.select({ revision: videoCuttingProjects.revision }).from(videoCuttingProjects)
        .where(and(eq(videoCuttingProjects.projectId, projectId), eq(videoCuttingProjects.sourceAssetId, sourceAssetId))).get();
      if ((latest?.revision ?? 0) !== revision) throw new CompositionDeliveryError("剪辑工程已变化，请重新保存");
      const already = database.select({ assetId: videoCuttingOutputs.assetId }).from(videoCuttingOutputs).where(outputWhere).get();
      if (already) return already.assetId;
      const reused = database.select().from(assets).where(eq(assets.contentHash, hash!)).get();
      if (reused?.deletedAt) throw new CompositionDeliveryError("相同成片在回收站中，请先恢复");
      const id = reused?.id ?? randomUUID();
      if (!reused) database.insert(assets).values({ id, type: "video", originalName: filename(context.source.originalName),
        relativePath: relative(temp.paths.root, target!).replaceAll("\\", "/"), mimeType: "video/mp4",
        size: rendered.size, width: rendered.width, height: rendered.height, duration: rendered.duration,
        sourceType: "video-cutting", sourceUrl: `asset:${sourceAssetId}`, contentHash: hash!, createdAt: new Date() }).run();
      database.insert(projectAssets).values({ projectId, assetId: id, addedAt: new Date() }).onConflictDoNothing().run();
      database.insert(videoCuttingOutputs).values({ projectId, sourceAssetId, projectRevision: revision,
        assetId: id, createdAt: new Date() }).onConflictDoNothing().run();
      return database.select({ assetId: videoCuttingOutputs.assetId }).from(videoCuttingOutputs).where(outputWhere).get()!.assetId;
    });
    const asset = (await listProjectAssets(projectId)).find((item) => item.id === assetId);
    if (!asset) throw new Error("成片保存后无法读取资产");
    if (targetCreated && context.database.select({ path: assets.relativePath }).from(assets)
      .where(eq(assets.id, assetId)).get()?.path !== relative(temp.paths.root, target).replaceAll("\\", "/")) {
      await rm(target, { force: true });
      targetCreated = false;
    }
    await ensurePlaced(projectId, asset);
    return { asset, revision };
  } catch (error) {
    if (targetCreated && target && hash && !context.database.select({ id: assets.id }).from(assets).where(eq(assets.contentHash, hash)).get())
      await rm(target, { force: true });
    throw error;
  } finally { await rm(temp.directory, { recursive: true, force: true }); }
}
