import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DownloadTaskSummary } from "../types";
import { importImageBuffers, listProjectAssets } from "../../server/asset-catalog";
import { ensureProject } from "@/features/projects/server/project-service";
import { ensureAssetDataPaths, getAssetDataPaths, resolveStoredAssetPath } from "../../server/data-paths";
import { getAssetDatabase } from "../../server/database";
import { downloadItems, downloadTasks } from "../../server/schema";
import { DownloadHttpError } from "./http-client";
import { makeApngLoopForever } from "./apng";
import { lineDownloadAdapter } from "./line-adapter";

const runners = globalThis as typeof globalThis & {
  mowoDownloadRunners?: Map<string, AbortController>;
};
runners.mowoDownloadRunners ??= new Map();

function toTaskSummary(task: typeof downloadTasks.$inferSelect, items: Array<typeof downloadItems.$inferSelect>): DownloadTaskSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    platform: task.platform,
    sourceUrl: task.sourceUrl,
    sourceKind: task.sourceKind,
    title: task.title,
    status: task.status,
    progress: task.progress,
    total: task.total,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    items: items.map((item) => ({
      id: item.id,
      externalId: item.externalId,
      name: item.name,
      mimeType: item.mimeType,
      size: item.size,
      animated: item.animated,
      position: item.position,
      previewUrl: `/api/download-items/${item.id}/content`,
    })),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function classifyError(error: unknown) {
  if (error instanceof DownloadHttpError) return { code: error.code, message: error.message };
  if (error instanceof Error && /LINE|贴纸|表情包|代理|文件数量|体积|PNG/.test(error.message)) {
    return { code: "platform_error", message: error.message };
  }
  return { code: "download_failed", message: "LINE 下载失败，请稍后重试并检查网络或代理设置" };
}

async function executeDownloadTask(taskId: string) {
  if (runners.mowoDownloadRunners!.has(taskId)) return;
  const database = await getAssetDatabase();
  const task = database.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();
  if (!task || !["queued", "resolving", "downloading"].includes(task.status)) return;

  const controller = new AbortController();
  runners.mowoDownloadRunners!.set(taskId, controller);
  const paths = await ensureAssetDataPaths();
  const directory = join(/* turbopackIgnore: true */ paths.tempDownloads, taskId);

  try {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    database.delete(downloadItems).where(eq(downloadItems.taskId, taskId)).run();
    database.update(downloadTasks).set({ status: "resolving", progress: 0, total: 0, errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(downloadTasks.id, taskId)).run();

    const result = await lineDownloadAdapter.download(task.sourceUrl, {
      directory,
      signal: controller.signal,
      onResolved(total, title, sourceKind) {
        database.update(downloadTasks).set({ status: "downloading", total, title, sourceKind, updatedAt: new Date() })
          .where(eq(downloadTasks.id, taskId)).run();
      },
      onProgress(progress, total) {
        database.update(downloadTasks).set({ status: "downloading", progress, total, updatedAt: new Date() })
          .where(eq(downloadTasks.id, taskId)).run();
      },
    });

    const now = new Date();
    database.insert(downloadItems).values(result.files.map((file) => ({
      id: randomUUID(),
      taskId,
      externalId: file.externalId,
      name: file.name,
      relativePath: relative(paths.root, file.absolutePath).replaceAll("\\", "/"),
      mimeType: file.mimeType,
      size: file.size,
      animated: file.animated,
      position: file.position,
      createdAt: now,
    }))).run();
    database.update(downloadTasks).set({
      status: "ready",
      progress: result.files.length,
      total: result.files.length,
      title: result.title,
      sourceKind: result.sourceKind,
      updatedAt: now,
    }).where(eq(downloadTasks.id, taskId)).run();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    const cancelled = controller.signal.aborted;
    const failure = classifyError(error);
    database.update(downloadTasks).set({
      status: cancelled ? "cancelled" : "failed",
      errorCode: cancelled ? "cancelled" : failure.code,
      errorMessage: cancelled ? "下载已取消" : failure.message,
      updatedAt: new Date(),
    }).where(eq(downloadTasks.id, taskId)).run();
  } finally {
    runners.mowoDownloadRunners!.delete(taskId);
  }
}

export async function createDownloadTask(projectId: string, sourceUrl: string) {
  if (!projectId || projectId.length > 120) throw new Error("项目参数无效");
  if (!sourceUrl || sourceUrl.length > 2_000) throw new Error("请输入有效的 LINE 链接");
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("请输入有效的 LINE 链接"); }
  if (!lineDownloadAdapter.supports(url)) throw new Error("请输入受支持的 LINE 贴纸或表情包链接");

  await ensureProject(projectId);
  const database = await getAssetDatabase();
  const id = randomUUID();
  const now = new Date();
  database.insert(downloadTasks).values({
    id,
    projectId,
    platform: "line",
    sourceUrl: url.toString(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
  }).run();
  void executeDownloadTask(id);
  return getDownloadTask(id);
}

export async function getDownloadTask(taskId: string) {
  const database = await getAssetDatabase();
  const task = database.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();
  if (!task) return null;
  const items = database.select().from(downloadItems).where(eq(downloadItems.taskId, taskId)).orderBy(asc(downloadItems.position)).all();
  if (["queued", "resolving", "downloading"].includes(task.status) && !runners.mowoDownloadRunners!.has(taskId)) {
    void executeDownloadTask(taskId);
  }
  return toTaskSummary(task, items);
}

export async function cancelDownloadTask(taskId: string) {
  const database = await getAssetDatabase();
  const task = database.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();
  if (!task) return null;
  if (["completed", "failed", "cancelled"].includes(task.status)) return getDownloadTask(taskId);
  runners.mowoDownloadRunners!.get(taskId)?.abort(new Error("cancelled"));
  const paths = getAssetDataPaths();
  await rm(join(/* turbopackIgnore: true */ paths.tempDownloads, taskId), { recursive: true, force: true });
  database.delete(downloadItems).where(eq(downloadItems.taskId, taskId)).run();
  database.update(downloadTasks).set({ status: "cancelled", errorCode: "cancelled", errorMessage: "下载已取消", updatedAt: new Date() })
    .where(eq(downloadTasks.id, taskId)).run();
  return getDownloadTask(taskId);
}

export async function getDownloadItemContent(itemId: string) {
  const database = await getAssetDatabase();
  const item = database.select().from(downloadItems).where(eq(downloadItems.id, itemId)).get();
  if (!item) return null;
  return { path: resolveStoredAssetPath(item.relativePath), mimeType: item.mimeType, name: item.name, animated: item.animated };
}

export async function importDownloadTask(taskId: string, itemIds: string[], discardUnselected: boolean) {
  if (!itemIds.length || itemIds.length > 500) throw new Error("请至少选择一张图片");
  const database = await getAssetDatabase();
  const task = database.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();
  if (!task || task.status !== "ready") throw new Error("下载任务尚未准备好或已经处理");
  const selected = database.select().from(downloadItems)
    .where(and(eq(downloadItems.taskId, taskId), inArray(downloadItems.id, itemIds)))
    .orderBy(asc(downloadItems.position)).all();
  if (selected.length !== new Set(itemIds).size) throw new Error("选择的下载项目无效");

  database.update(downloadTasks).set({ status: "importing", updatedAt: new Date() }).where(eq(downloadTasks.id, taskId)).run();
  try {
    const sources = await Promise.all(selected.map(async (item) => {
      const buffer = await readFile(resolveStoredAssetPath(item.relativePath));
      return {
        buffer: item.animated ? makeApngLoopForever(buffer) : buffer,
        name: item.name,
        mimeType: "image/png" as const,
        sourceType: "line",
        sourceUrl: task.sourceUrl,
      };
    }));
    const result = await importImageBuffers(task.projectId, sources, {
      name: `${new Date().toLocaleString("zh-CN", { hour12: false })} 下载`,
      sourceType: "line",
      sourceUrl: task.sourceUrl,
    });

    const paths = getAssetDataPaths();
    const allItems = database.select().from(downloadItems).where(eq(downloadItems.taskId, taskId)).all();
    const selectedSet = new Set(selected.map((item) => item.id));
    if (!discardUnselected) {
      for (const item of allItems.filter((value) => !selectedSet.has(value.id))) {
        const source = resolveStoredAssetPath(item.relativePath);
        const target = join(/* turbopackIgnore: true */ paths.downloadArchive, "line", taskId, item.name);
        await mkdir(dirname(target), { recursive: true });
        await rename(source, target);
      }
    }
    await rm(join(/* turbopackIgnore: true */ paths.tempDownloads, taskId), { recursive: true, force: true });
    database.delete(downloadItems).where(eq(downloadItems.taskId, taskId)).run();
    database.update(downloadTasks).set({ status: "completed", errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(downloadTasks.id, taskId)).run();
    return { ...result, assets: await listProjectAssets(task.projectId) };
  } catch (error) {
    database.update(downloadTasks).set({ status: "ready", updatedAt: new Date() }).where(eq(downloadTasks.id, taskId)).run();
    throw error;
  }
}
