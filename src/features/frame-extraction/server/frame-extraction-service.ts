import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import sharp from "sharp";
import { isAnimatedPng } from "@/features/assets/downloaders/server/apng";
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
import type { FrameExtractionTask, SavedFrameSequence } from "../types";
import { decodeApngFrames } from "./apng-frame-decoder";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
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

async function decodeFrames(path: string, mimeType: string | null) {
  if (mimeType !== "image/png" && mimeType !== "image/gif") {
    throw new FrameExtractionError("UNSUPPORTED_FORMAT", "第一版仅支持 APNG 和 GIF 动图");
  }
  if (mimeType === "image/png") {
    const buffer = await readFile(path);
    if (!isAnimatedPng(buffer)) throw new FrameExtractionError("NOT_ANIMATED", "该 PNG 不包含可拆解的动画帧");
    return decodeApngFrames(buffer);
  }
  const image = sharp(path, { animated: true, limitInputPixels: 268_402_689 });
  const metadata = await image.metadata();
  const pages = metadata.pages ?? 1;
  const pageHeight = metadata.pageHeight ?? metadata.height;
  if (!metadata.width || !pageHeight || pages < 2) {
    throw new FrameExtractionError("NOT_ANIMATED", "该图片不包含可拆解的动画帧");
  }
  if (pages > MAX_FRAMES_PER_SOURCE) {
    throw new FrameExtractionError("TOO_MANY_FRAMES", `单个动图最多支持 ${MAX_FRAMES_PER_SOURCE} 帧`);
  }
  const delays = metadata.delay ?? [];
  const frames: Array<{ buffer: Buffer; durationMs: number }> = [];
  for (let index = 0; index < pages; index += 1) {
    const buffer = await sharp(path, { page: index, pages: 1, limitInputPixels: 268_402_689 }).png().toBuffer();
    frames.push({ buffer, durationMs: normalizeDelay(delays[index]) });
  }
  return { width: metadata.width, height: pageHeight, frames };
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
      frames: frames.filter((frame) => frame.sourceId === source.id).map((frame) => ({
        id: frame.id,
        sourcePosition: frame.sourcePosition,
        position: frame.position,
        timelineStartMs: frame.timelineStartMs,
        durationMs: frame.durationMs,
        retained: frame.retained,
        previewUrl: taskPreviewUrl(task.id, frame.id),
      })),
    })),
  };
}

async function cleanupExpiredDrafts() {
  const database = await getAssetDatabase();
  const expired = database.select({ id: frameExtractionTasks.id }).from(frameExtractionTasks).where(lt(frameExtractionTasks.expiresAt, new Date())).all();
  if (!expired.length) return;
  const paths = await ensureAssetDataPaths();
  for (const task of expired) {
    await rm(join(paths.tempFrameExtraction, task.id), { recursive: true, force: true });
    database.delete(frameExtractionTasks).where(eq(frameExtractionTasks.id, task.id)).run();
  }
}

export async function createFrameExtractionTask(projectId: string, assetIds: string[], existingTaskId?: string) {
  await cleanupExpiredDrafts();
  const database = await getAssetDatabase();
  const existingTask = existingTaskId ? database.select().from(frameExtractionTasks).where(and(eq(frameExtractionTasks.id, existingTaskId), eq(frameExtractionTasks.projectId, projectId))).get() : undefined;
  const existingSources = existingTask ? database.select().from(frameExtractionSources).where(eq(frameExtractionSources.taskId, existingTask.id)).all() : [];
  const existingAssetIds = new Set(existingSources.map((source) => source.sourceAssetId));
  const uniqueAssetIds = [...new Set(assetIds)].filter((assetId) => !existingAssetIds.has(assetId));
  if (existingTask && !uniqueAssetIds.length) return getFrameExtractionTask(existingTask.id);
  if (!uniqueAssetIds.length) throw new FrameExtractionError("NO_INPUTS", "请先连接至少一张动图");
  if (uniqueAssetIds.length + existingSources.length > MAX_SOURCES) throw new FrameExtractionError("TOO_MANY_INPUTS", `单次最多拆解 ${MAX_SOURCES} 张动图`);
  const linked = database.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), inArray(assets.id, uniqueAssetIds))).all();
  if (linked.length !== uniqueAssetIds.length) throw new FrameExtractionError("ASSET_UNAVAILABLE", "部分素材不存在或不属于当前项目");
  const byId = new Map(linked.map(({ asset }) => [asset.id, asset]));
  const taskId = existingTask?.id ?? randomUUID();
  const now = new Date();
  if (existingTask) database.update(frameExtractionTasks).set({ status: "processing", updatedAt: now, expiresAt: new Date(now.getTime() + DRAFT_TTL_MS) }).where(eq(frameExtractionTasks.id, taskId)).run();
  else database.insert(frameExtractionTasks).values({ id: taskId, projectId, status: "processing", createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + DRAFT_TTL_MS) }).run();

  for (const [offset, assetId] of uniqueAssetIds.entries()) {
    const position = existingSources.length + offset;
    const asset = byId.get(assetId);
    const sourceId = randomUUID();
    if (!asset?.relativePath) {
      database.insert(frameExtractionSources).values({ id: sourceId, taskId, sourceAssetId: assetId, position, status: "failed", name: asset?.originalName ?? "未知素材", errorCode: "ASSET_UNAVAILABLE", errorMessage: "素材不存在或不属于当前项目" }).run();
      continue;
    }
    try {
      const decoded = await decodeFrames(resolveStoredAssetPath(asset.relativePath), asset.mimeType);
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
  const status = successfulCount === finalSources.length ? "ready" : successfulCount ? "partial" : "failed";
  database.update(frameExtractionTasks).set({ status, updatedAt: new Date() }).where(eq(frameExtractionTasks.id, taskId)).run();
  return getFrameExtractionTask(taskId);
}

export async function updateFrameSequenceDraft(taskId: string, sourceId: string, orderedFrameIds: string[]) {
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
    orderedFrameIds.forEach((frameId, position) => {
      tx.update(frameExtractionFrames).set({ retained: true, position }).where(eq(frameExtractionFrames.id, frameId)).run();
    });
  });
  return getFrameExtractionTask(taskId);
}

async function storeDerivedPng(buffer: Buffer, name: string) {
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
    width: metadata.width, height: metadata.height, sourceType: "frame-extraction", contentHash: hash, createdAt: new Date(),
  };
  database.insert(assets).values(asset).run();
  return asset;
}

export async function saveFrameSequence(taskId: string, sourceId: string): Promise<SavedFrameSequence> {
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
  database.transaction((tx) => {
    tx.insert(assetCollections).values({ id: collectionId, projectId: task.projectId, name: `${basename(source.name, extname(source.name))} 序列帧`, kind: "frame-sequence", sourceType: "frame-extraction", createdAt: new Date() }).run();
    tx.insert(assetCollectionItems).values(frames.map((frame, index) => ({ id: randomUUID(), collectionId, assetId: stored[index].id, position: index, sourcePosition: frame.sourcePosition, timelineStartMs: frame.timelineStartMs, durationMs: frame.durationMs }))).run();
    tx.insert(assetDerivations).values({ id: derivationId, projectId: task.projectId, operationType: "frame-extraction", processorVersion: PROCESSOR_VERSION, parametersJson: JSON.stringify({ retainedSourcePositions: frames.map((frame) => frame.sourcePosition) }), createdAt: new Date() }).run();
    tx.insert(assetDerivationInputs).values({ id: randomUUID(), derivationId, assetId: source.sourceAssetId, position: 0 }).run();
    tx.insert(assetDerivationOutputs).values([{ id: randomUUID(), derivationId, collectionId, position: 0 }, ...stored.map((asset, index) => ({ id: randomUUID(), derivationId, assetId: asset.id, position: index + 1 }))]).run();
    tx.insert(projectAssets).values(stored.map((asset) => ({ projectId: task.projectId, assetId: asset.id, addedAt: new Date() }))).onConflictDoNothing().run();
    tx.update(frameExtractionSources).set({ status: "saved", collectionId }).where(eq(frameExtractionSources.id, sourceId)).run();
    allDraftFrames.filter((frame) => !frame.retained).forEach((frame) => tx.delete(frameExtractionFrames).where(eq(frameExtractionFrames.id, frame.id)).run());
    frames.forEach((frame, index) => tx.update(frameExtractionFrames).set({ relativePath: stored[index].relativePath ?? frame.relativePath }).where(eq(frameExtractionFrames.id, frame.id)).run());
  });
  await Promise.all(allDraftFrames.map((frame) => rm(resolveStoredAssetPath(frame.relativePath), { force: true })));
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
