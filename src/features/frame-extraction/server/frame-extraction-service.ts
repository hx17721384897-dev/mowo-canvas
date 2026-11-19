import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import sharp from "sharp";
import { apngFrameCount } from "@/features/assets/downloaders/server/apng";
import { ensureAssetDataPaths, resolveStoredAssetPath } from "@/features/assets/server/data-paths";
import { getAssetDatabase } from "@/features/assets/server/database";
import {
  assetCollectionItems,
  assetCollections,
  assetDerivationInputs,
  assetDerivationOutputs,
  assetDerivations,
  assets,
  frameExtractionFrames,
  frameExtractionSources,
  frameExtractionTasks,
  projectAssets,
} from "@/features/assets/server/schema";
import type { FrameExtractionTask, FrameInputReview, SavedFrameSequence } from "../types";
import { decodeApngFrames } from "./apng-frame-decoder";
import { cleanupOrphanedFrameFiles } from "./draft-retention";
import { stitchLayout, type StitchSettings } from "../stitch-layout";
import { renderStitch } from "./render-stitch";

// The legacy non-null column remains for older canvas snapshots. Draft lifetime is now project-bound.
const NO_DRAFT_EXPIRY = new Date("9999-12-31T00:00:00.000Z");
const PROCESSOR_VERSION = "1.0.0";
const MAX_SOURCES = 50;
const MAX_FRAMES_PER_SOURCE = 1000;

class FrameExtractionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function normalizeDelay(delay: number | undefined) {
  return Math.max(20, delay && Number.isFinite(delay) ? delay : 100);
}

async function inspectImage(path: string) {
  const metadata = await sharp(path, { animated: true, limitInputPixels: 268_402_689 }).metadata();
  const png = metadata.format === "png" ? await readFile(path) : undefined;
  const pages = png ? apngFrameCount(png) : metadata.pages ?? 1;
  const format = png && pages > 1 ? "APNG" : metadata.format?.toUpperCase() ?? "未知";
  return { metadata, png, pages, format };
}

async function decodeFrames(path: string) {
  const { metadata, png, pages, format } = await inspectImage(path);
  if (format !== "APNG" && format !== "GIF" && format !== "PNG") {
    throw new FrameExtractionError("UNSUPPORTED_FORMAT", "第一版仅支持 APNG 和 GIF 动图");
  }
  const pageHeight = metadata.pageHeight ?? metadata.height;
  if (!metadata.width || !pageHeight || pages < 2) {
    throw new FrameExtractionError("NOT_ANIMATED", "该图片不包含可拆解的动画帧");
  }
  if (pages > MAX_FRAMES_PER_SOURCE) {
    throw new FrameExtractionError("TOO_MANY_FRAMES", `单个动图最多支持 ${MAX_FRAMES_PER_SOURCE} 帧`);
  }
  if (png) return decodeApngFrames(png);
  const delays = metadata.delay ?? [];
  const frames: Array<{ buffer: Buffer; durationMs: number }> = [];
  for (let index = 0; index < pages; index += 1) {
    const buffer = await sharp(path, { page: index, pages: 1, limitInputPixels: 268_402_689 }).png().toBuffer();
    frames.push({ buffer, durationMs: normalizeDelay(delays[index]) });
  }
  return { width: metadata.width, height: pageHeight, frames };
}

async function findProjectImages(projectId: string, assetIds: string[]) {
  const database = await getAssetDatabase();
  return database.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), inArray(assets.id, assetIds), eq(assets.type, "image"), isNull(assets.deletedAt))).all();
}

export async function reviewFrameInputs(projectId: string, assetIds: string[], taskId?: string): Promise<FrameInputReview[]> {
  const ids = [...new Set(assetIds)];
  if (ids.length > 500) throw new FrameExtractionError("TOO_MANY_INPUTS", "一次最多检查 500 张图片");
  if (!ids.length) return [];
  const linked = new Map((await findProjectImages(projectId, ids)).map(({ asset }) => [asset.id, asset]));
  const task = taskId ? await getFrameExtractionTask(taskId) : null;
  const completed = new Set(task?.projectId === projectId ? task.sources.filter((source) => source.status !== "failed").map((source) => source.sourceAssetId) : []);
  const result: FrameInputReview[] = [];
  for (const assetId of ids) {
    const asset = linked.get(assetId);
    const item = { assetId, name: asset?.originalName ?? "未知素材", format: "未知" };
    try {
      if (!asset?.relativePath) throw new Error("素材不可用");
      const { format, pages } = await inspectImage(resolveStoredAssetPath(asset.relativePath));
      if (completed.has(assetId)) result.push({ ...item, format, status: "existing", reason: "已有拆帧结果" });
      else if (pages < 2) result.push({ ...item, format, status: "static", reason: "没有多个动画帧" });
      else if (format !== "APNG" && format !== "GIF") result.push({ ...item, format, status: "unsupported", reason: "目前仅支持 APNG 和 GIF 动图" });
      else if (pages > MAX_FRAMES_PER_SOURCE) result.push({ ...item, format, status: "unsupported", reason: "帧数超过上限" });
      else result.push({ ...item, format, status: "ready" });
    } catch (error) {
      if (asset?.relativePath) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        console.warn(`[frame-review] 素材检查失败 ${JSON.stringify({ assetId, code, type: error instanceof Error ? error.name : typeof error })}`);
      }
      result.push({ ...item, status: "unavailable", reason: "素材缺失、无法读取或已损坏" });
    }
  }
  return result;
}

function taskPreviewUrl(taskId: string, frameId: string) {
  return `/api/frame-extraction/tasks/${taskId}/frames/${frameId}`;
}

export async function getFrameExtractionTask(taskId: string): Promise<FrameExtractionTask | null> {
  const database = await getAssetDatabase();
  const task = database.select().from(frameExtractionTasks).where(eq(frameExtractionTasks.id, taskId)).get();
  if (!task) return null;
  const sources = database.select().from(frameExtractionSources).where(eq(frameExtractionSources.taskId, taskId)).orderBy(asc(frameExtractionSources.position)).all();
  const sourceIds = sources.map((source) => source.id);
  const frames = sourceIds.length
    ? database.select().from(frameExtractionFrames).where(inArray(frameExtractionFrames.sourceId, sourceIds)).orderBy(asc(frameExtractionFrames.position)).all()
    : [];
  return {
    id: task.id,
    projectId: task.projectId,
    status: task.status,
    expiresAt: task.expiresAt.toISOString(),
    sources: sources.map((source) => ({
      id: source.id,
      sourceAssetId: source.sourceAssetId,
      name: source.name,
      position: source.position,
      status: source.status,
      width: source.width,
      height: source.height,
      totalDurationMs: source.totalDurationMs,
      collectionId: source.collectionId,
      errorCode: source.errorCode,
      errorMessage: source.errorMessage,
      sourceKind: source.sourceKind,
      parameters: JSON.parse(source.parametersJson) as Record<string, unknown>,
      frames: frames.filter((frame) => frame.sourceId === source.id).map((frame) => ({
        id: frame.id,
        sourcePosition: frame.sourcePosition,
        position: frame.position,
        timelineStartMs: frame.timelineStartMs,
        durationMs: frame.durationMs,
        retained: frame.retained,
        ...(frame.sourceMappingJson ? { sourceMapping: JSON.parse(frame.sourceMappingJson) as { sourceStartFrame: number; sourceEndFrame: number; sourcePts: number } } : {}),
        previewUrl: taskPreviewUrl(task.id, frame.id),
      })),
    })),
  };
}

export async function createFrameExtractionTask(projectId: string, assetIds: string[], existingTaskId?: string) {
  const database = await getAssetDatabase();
  const taskIds = new Set(database.select({ id: frameExtractionTasks.id }).from(frameExtractionTasks).all().map((task) => task.id));
  await cleanupOrphanedFrameFiles((await ensureAssetDataPaths()).tempFrameExtraction, taskIds).catch((error) => {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    console.warn(`[frame-extraction] 孤立临时文件清理失败 ${JSON.stringify({ code })}`);
  });
  const existingTask = existingTaskId ? database.select().from(frameExtractionTasks).where(and(eq(frameExtractionTasks.id, existingTaskId), eq(frameExtractionTasks.projectId, projectId))).get() : undefined;
  const existingSources = existingTask ? database.select().from(frameExtractionSources).where(eq(frameExtractionSources.taskId, existingTask.id)).all() : [];
  const existingAssetIds = new Set(existingSources.filter((source) => source.status !== "failed").map((source) => source.sourceAssetId));
  const uniqueAssetIds = [...new Set(assetIds)].filter((assetId) => !existingAssetIds.has(assetId));
  if (existingTask && !uniqueAssetIds.length) return getFrameExtractionTask(existingTask.id);
  if (!uniqueAssetIds.length) throw new FrameExtractionError("NO_INPUTS", "请先连接至少一张动图");
  if (uniqueAssetIds.length > MAX_SOURCES) throw new FrameExtractionError("TOO_MANY_INPUTS", `单次最多拆解 ${MAX_SOURCES} 张动图`);
  const linked = await findProjectImages(projectId, uniqueAssetIds);
  if (!linked.length) throw new FrameExtractionError("ASSET_UNAVAILABLE", "所选素材已不可用，请重新检查");
  const byId = new Map(linked.map(({ asset }) => [asset.id, asset]));
  const taskId = existingTask?.id ?? randomUUID();
  const now = new Date();
  if (existingTask) database.update(frameExtractionTasks).set({ status: "processing", updatedAt: now, expiresAt: NO_DRAFT_EXPIRY }).where(eq(frameExtractionTasks.id, taskId)).run();
  else database.insert(frameExtractionTasks).values({ id: taskId, projectId, status: "processing", createdAt: now, updatedAt: now, expiresAt: NO_DRAFT_EXPIRY }).run();

  for (const [offset, assetId] of uniqueAssetIds.entries()) {
    const previous = existingSources.find((source) => source.sourceAssetId === assetId && source.status === "failed");
    const position = previous?.position ?? Math.max(-1, ...existingSources.map((source) => source.position)) + 1 + offset;
    const asset = byId.get(assetId);
    const sourceId = randomUUID();
    if (!asset?.relativePath) {
      continue;
    }
    if (previous) database.delete(frameExtractionSources).where(eq(frameExtractionSources.id, previous.id)).run();
    try {
      const decoded = await decodeFrames(resolveStoredAssetPath(asset.relativePath));
      const sourceDir = join((await ensureAssetDataPaths()).tempFrameExtraction, taskId, sourceId);
      await mkdir(sourceDir, { recursive: true });
      let timelineStartMs = 0;
      const rows = [];
      for (const [framePosition, frame] of decoded.frames.entries()) {
        const frameId = randomUUID();
        const target = join(sourceDir, `${String(framePosition + 1).padStart(4, "0")}.png`);
        await writeFile(target, frame.buffer, { flag: "wx" });
        rows.push({
          id: frameId,
          sourceId,
          sourcePosition: framePosition,
          position: framePosition,
          relativePath: relative((await ensureAssetDataPaths()).root, target).replaceAll("\\", "/"),
          width: decoded.width,
          height: decoded.height,
          timelineStartMs,
          durationMs: frame.durationMs,
          retained: true,
        });
        timelineStartMs += frame.durationMs;
      }
      database.insert(frameExtractionSources).values({ id: sourceId, taskId, sourceAssetId: asset.id, position, status: "ready", name: asset.originalName, width: decoded.width, height: decoded.height, totalDurationMs: timelineStartMs }).run();
      database.insert(frameExtractionFrames).values(rows).run();
    } catch (error) {
      const known = error instanceof FrameExtractionError ? error : new FrameExtractionError("DECODE_FAILED", "动图解码失败，请检查文件是否完整");
      database.insert(frameExtractionSources).values({ id: sourceId, taskId, sourceAssetId: asset.id, position, status: "failed", name: asset.originalName, errorCode: known.code, errorMessage: known.message }).run();
    }
  }
  const finalSources = database.select().from(frameExtractionSources).where(eq(frameExtractionSources.taskId, taskId)).all();
  const successfulCount = finalSources.filter((source) => source.status !== "failed").length;
  const status = !successfulCount ? "failed" : successfulCount === finalSources.length && linked.length === uniqueAssetIds.length ? "ready" : "partial";
  database.update(frameExtractionTasks).set({ status, updatedAt: new Date() }).where(eq(frameExtractionTasks.id, taskId)).run();
  return getFrameExtractionTask(taskId);
}

export async function updateFrameSequenceDraft(taskId: string, sourceId: string, orderedFrameIds: string[], duration?: { frameId: string; durationMs: number }) {
  const database = await getAssetDatabase();
  const source = database.select().from(frameExtractionSources).where(and(eq(frameExtractionSources.id, sourceId), eq(frameExtractionSources.taskId, taskId))).get();
  if (!source || source.status !== "ready") throw new FrameExtractionError("DRAFT_UNAVAILABLE", "该序列草稿不可编辑");
  const frames = database.select().from(frameExtractionFrames).where(eq(frameExtractionFrames.sourceId, sourceId)).all();
  const validIds = new Set(frames.map((frame) => frame.id));
  if (!orderedFrameIds.length || new Set(orderedFrameIds).size !== orderedFrameIds.length || orderedFrameIds.some((id) => !validIds.has(id))) {
    throw new FrameExtractionError("INVALID_FRAME_ORDER", "至少保留一帧，且不能包含重复或未知帧");
  }
  database.transaction((tx) => {
    tx.update(frameExtractionFrames).set({ retained: false }).where(eq(frameExtractionFrames.sourceId, sourceId)).run();
    frames.forEach((frame, index) => {
      tx.update(frameExtractionFrames).set({ position: 100_000 + index }).where(eq(frameExtractionFrames.id, frame.id)).run();
    });
    let timelineStartMs = 0;
    const durations = new Map(frames.map((frame) => [frame.id, frame.durationMs]));
    orderedFrameIds.forEach((frameId, position) => {
      const durationMs = duration?.frameId === frameId ? duration.durationMs : durations.get(frameId)!;
      tx.update(frameExtractionFrames).set({ retained: true, position, durationMs, timelineStartMs }).where(eq(frameExtractionFrames.id, frameId)).run();
      timelineStartMs += durationMs;
    });
    tx.update(frameExtractionSources).set({ totalDurationMs: timelineStartMs }).where(eq(frameExtractionSources.id, sourceId)).run();
  });
  return getFrameExtractionTask(taskId);
}

async function storeDerivedPng(buffer: Buffer, name: string, sourceType = "frame-extraction") {
  const paths = await ensureAssetDataPaths();
  const hash = createHash("sha256").update(buffer).digest("hex");
  const database = await getAssetDatabase();
  const existing = database.select().from(assets).where(eq(assets.contentHash, hash)).get();
  if (existing) return existing;
  const target = join(paths.imageDerived, hash.slice(0, 2), `${hash}.png`);
  const temporary = join(paths.tempImports, `${randomUUID()}.png`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, buffer, { flag: "wx" });
  try { await rename(temporary, target); } catch (error) { await rm(temporary, { force: true }); throw error; }
  const metadata = await sharp(buffer).metadata();
  const asset = {
    id: randomUUID(), type: "image" as const, originalName: `${basename(name, extname(name))}.png`,
    relativePath: relative(paths.root, target).replaceAll("\\", "/"), mimeType: "image/png", size: buffer.length,
    width: metadata.width, height: metadata.height, sourceType, contentHash: hash, createdAt: new Date(),
  };
  database.insert(assets).values(asset).onConflictDoNothing().run();
  return database.select().from(assets).where(eq(assets.contentHash, hash)).get() ?? asset;
}

export async function stitchFrameSequences(projectId: string, taskId: string, requests: Array<{ sourceId: string; frameIds: string[]; settings: StitchSettings }>) {
  const database = await getAssetDatabase();
  const task = await getFrameExtractionTask(taskId);
  if (!task || task.projectId !== projectId) throw new FrameExtractionError("DRAFT_UNAVAILABLE", "找不到当前项目的动画帧序列");
  const outputs = [];
  const failures: string[] = [];
  for (const request of requests) {
    const source = task.sources.find((item) => item.id === request.sourceId);
    try {
      if (!source || source.status === "failed" || !source.width || !source.height) throw new Error("序列不可用");
      const frames = source.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position);
      if (!frames.length || frames.length !== request.frameIds.length || frames.some((frame, index) => frame.id !== request.frameIds[index])) {
        throw new Error("序列已更改，请刷新后再拼接");
      }
      const layout = stitchLayout(frames.length, source.width, source.height, request.settings);
      if (layout.width > 16384 || layout.height > 16384 || layout.width * layout.height > 40_000_000) throw new Error("拼图尺寸超过上限，请调整列数或减少帧数");
      const inputs: string[] = [];
      for (const frame of frames) {
        const content = await getDraftFrameContent(taskId, frame.id);
        if (!content) throw new Error("帧文件不存在");
        inputs.push(content.path);
      }
      const image = await renderStitch(layout, inputs);
      const name = `${basename(source.name, extname(source.name))}-拼接.png`;
      const asset = await storeDerivedPng(image, name, "frame-stitch");
      const derivationId = randomUUID();
      database.transaction((tx) => {
        tx.insert(projectAssets).values({ projectId, assetId: asset.id, addedAt: new Date() }).onConflictDoNothing().run();
        tx.insert(assetDerivations).values({ id: derivationId, projectId, operationType: "frame-stitch", processorVersion: "1.0.0",
          parametersJson: JSON.stringify({ ...layout, taskId, sourceId: source.id, sourceKind: source.sourceKind,
            processing: source.parameters, frames: frames.map(({ id, durationMs, sourcePosition, sourceMapping }) => ({ id, durationMs, sourcePosition, sourceMapping })) }), createdAt: new Date() }).run();
        tx.insert(assetDerivationInputs).values({ id: randomUUID(), derivationId, assetId: source.sourceAssetId, position: 0 }).run();
        if (source.collectionId) tx.insert(assetDerivationInputs).values({ id: randomUUID(), derivationId, collectionId: source.collectionId, position: 1 }).run();
        tx.insert(assetDerivationOutputs).values({ id: randomUUID(), derivationId, assetId: asset.id, position: 0 }).run();
      });
      outputs.push({ id: asset.id, name, width: layout.width, height: layout.height, previewUrl: `/api/assets/${asset.id}/content`, derivationId });
    } catch (error) {
      const message = error instanceof Error && !("code" in error) && /^(序列|拼图|帧文件)/.test(error.message) ? error.message : "无法读取帧或生成拼图";
      failures.push(`${source?.name ?? "未知序列"}：${message}`);
    }
  }
  return { outputs, failures };
}

const pendingSequenceSaves = new Map<string, Promise<SavedFrameSequence>>();
export function saveFrameSequence(taskId: string, sourceId: string): Promise<SavedFrameSequence> {
  const key = `${taskId}:${sourceId}`;
  let pending = pendingSequenceSaves.get(key);
  if (!pending) {
    pending = saveFrameSequenceInternal(taskId, sourceId).finally(() => pendingSequenceSaves.delete(key));
    pendingSequenceSaves.set(key, pending);
  }
  return pending;
}

async function saveFrameSequenceInternal(taskId: string, sourceId: string): Promise<SavedFrameSequence> {
  const database = await getAssetDatabase();
  const task = database.select().from(frameExtractionTasks).where(eq(frameExtractionTasks.id, taskId)).get();
  const source = database.select().from(frameExtractionSources).where(and(eq(frameExtractionSources.id, sourceId), eq(frameExtractionSources.taskId, taskId))).get();
  if (!task || !source) throw new FrameExtractionError("DRAFT_UNAVAILABLE", "找不到序列草稿");
  if (source.collectionId) {
    const items = database.select({ item: assetCollectionItems, asset: assets }).from(assetCollectionItems).innerJoin(assets, eq(assetCollectionItems.assetId, assets.id)).where(eq(assetCollectionItems.collectionId, source.collectionId)).orderBy(asc(assetCollectionItems.position)).all();
    return { sourceId, collectionId: source.collectionId, name: source.name, assets: items.map(({ item, asset }) => ({ id: asset.id, name: asset.originalName, previewUrl: `/api/assets/${asset.id}/content`, position: item.position, durationMs: item.durationMs ?? 100 })) };
  }
  const frames = database.select().from(frameExtractionFrames).where(and(eq(frameExtractionFrames.sourceId, sourceId), eq(frameExtractionFrames.retained, true))).orderBy(asc(frameExtractionFrames.position)).all();
  if (!frames.length) throw new FrameExtractionError("EMPTY_SEQUENCE", "至少保留一帧后才能保存");
  const stored: Array<Awaited<ReturnType<typeof storeDerivedPng>>> = [];
  for (const frame of frames) stored.push(await storeDerivedPng(await readFile(resolveStoredAssetPath(frame.relativePath)), `${basename(source.name, extname(source.name))}-${String(frame.position + 1).padStart(4, "0")}.png`));
  const collectionId = randomUUID();
  const derivationId = randomUUID();
  const allDraftFrames = database.select().from(frameExtractionFrames).where(eq(frameExtractionFrames.sourceId, sourceId)).all();
  let alreadySaved = false;
  database.transaction((tx) => {
    if (tx.select().from(frameExtractionSources).where(eq(frameExtractionSources.id, sourceId)).get()?.collectionId) {
      alreadySaved = true;
      return;
    }
    tx.insert(assetCollections).values({ id: collectionId, projectId: task.projectId, name: `${basename(source.name, extname(source.name))} 序列帧`, kind: "frame-sequence", sourceType: "frame-extraction", createdAt: new Date() }).run();
    tx.insert(assetCollectionItems).values(frames.map((frame, index) => ({ id: randomUUID(), collectionId, assetId: stored[index].id, position: index, sourcePosition: frame.sourcePosition, timelineStartMs: frame.timelineStartMs, durationMs: frame.durationMs }))).run();
    tx.insert(assetDerivations).values({ id: derivationId, projectId: task.projectId, operationType: "frame-extraction", processorVersion: PROCESSOR_VERSION, parametersJson: JSON.stringify({ retainedSourcePositions: frames.map((frame) => frame.sourcePosition),
      sourceKind: source.sourceKind, processing: JSON.parse(source.parametersJson) as unknown,
      sourceMappings: frames.map((frame) => frame.sourceMappingJson ? JSON.parse(frame.sourceMappingJson) as unknown : null) }), createdAt: new Date() }).run();
    tx.insert(assetDerivationInputs).values({ id: randomUUID(), derivationId, assetId: source.sourceAssetId, position: 0 }).run();
    tx.insert(assetDerivationOutputs).values([{ id: randomUUID(), derivationId, collectionId, position: 0 }, ...stored.map((asset, index) => ({ id: randomUUID(), derivationId, assetId: asset.id, position: index + 1 }))]).run();
    tx.insert(projectAssets).values(stored.map((asset) => ({ projectId: task.projectId, assetId: asset.id, addedAt: new Date() }))).onConflictDoNothing().run();
    tx.update(frameExtractionSources).set({ status: "saved", collectionId }).where(eq(frameExtractionSources.id, sourceId)).run();
    allDraftFrames.filter((frame) => !frame.retained).forEach((frame) => tx.delete(frameExtractionFrames).where(eq(frameExtractionFrames.id, frame.id)).run());
    frames.forEach((frame, index) => tx.update(frameExtractionFrames).set({ relativePath: stored[index].relativePath ?? frame.relativePath }).where(eq(frameExtractionFrames.id, frame.id)).run());
  }, { behavior: "immediate" });
  if (alreadySaved) return saveFrameSequenceInternal(taskId, sourceId);
  await Promise.all([...new Set(allDraftFrames.map((frame) => frame.relativePath))].map((path) => rm(resolveStoredAssetPath(path), { force: true })));
  const allSources = database.select().from(frameExtractionSources).where(eq(frameExtractionSources.taskId, taskId)).all();
  if (allSources.every((item) => item.status === "saved" || item.status === "failed")) database.update(frameExtractionTasks).set({ status: "saved", updatedAt: new Date() }).where(eq(frameExtractionTasks.id, taskId)).run();
  return { sourceId, collectionId, name: source.name, assets: stored.map((asset, position) => ({ id: asset.id, name: asset.originalName, previewUrl: `/api/assets/${asset.id}/content`, position, durationMs: frames[position].durationMs })) };
}

export async function getDraftFrameContent(taskId: string, frameId: string) {
  const database = await getAssetDatabase();
  const row = database.select({ frame: frameExtractionFrames, source: frameExtractionSources }).from(frameExtractionFrames).innerJoin(frameExtractionSources, eq(frameExtractionFrames.sourceId, frameExtractionSources.id))
    .where(and(eq(frameExtractionFrames.id, frameId), eq(frameExtractionSources.taskId, taskId))).get();
  if (!row) return null;
  const path = resolveStoredAssetPath(row.frame.relativePath);
  await stat(path);
  return { path, name: `${basename(row.source.name, extname(row.source.name))}-${row.frame.sourcePosition + 1}.png` };
}

export function toFrameExtractionError(error: unknown) {
  if (error instanceof FrameExtractionError) return { status: 400, code: error.code, message: error.message };
  return { status: 500, code: "FRAME_EXTRACTION_FAILED", message: "动图拆帧失败" };
}
