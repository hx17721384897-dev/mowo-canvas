import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "./database";
import { belongsToLegacyDownloadBatch } from "./legacy-download-batches";
import { assetCollections, assetFolderItems, assetFolders, assets, downloadTasks, projectAssets, projects } from "./schema";

export type SourceCategory = "download" | "import";

export async function listSourceFolders(projectId: string) {
  const db = await getAssetDatabase();
  const folders = db.select().from(assetFolders).where(eq(assetFolders.projectId, projectId)).all();
  const items = db.select({ assetId: assetFolderItems.assetId, folderId: assetFolderItems.folderId })
    .from(assetFolderItems).where(eq(assetFolderItems.projectId, projectId)).all();
  return { folders: folders.map((folder) => ({ id: folder.id, name: folder.name, sourceCategory: folder.sourceCategory,
    createdAt: folder.createdAt.toISOString() })), placements: items };
}

export async function createSourceFolder(projectId: string, name: string, sourceCategory: SourceCategory) {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new Error("文件夹名称需为 1 至 80 个字");
  const db = await getAssetDatabase();
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw new Error("项目不存在");
  const folder = { id: randomUUID(), projectId, name: clean, sourceCategory, createdAt: new Date() };
  db.insert(assetFolders).values(folder).run();
  return { id: folder.id, name: clean, sourceCategory, createdAt: folder.createdAt.toISOString() };
}

export async function renameSourceFolder(projectId: string, folderId: string, name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new Error("文件夹名称需为 1 至 80 个字");
  const db = await getAssetDatabase();
  const result = db.update(assetFolders).set({ name: clean })
    .where(and(eq(assetFolders.id, folderId), eq(assetFolders.projectId, projectId))).run();
  if (!result.changes) throw new Error("文件夹不存在");
}

export async function deleteSourceFolder(projectId: string, folderId: string) {
  const db = await getAssetDatabase();
  const result = db.delete(assetFolders).where(and(eq(assetFolders.id, folderId), eq(assetFolders.projectId, projectId))).run();
  if (!result.changes) throw new Error("文件夹不存在");
}

export async function renameDownloadBatch(projectId: string, batchId: string, name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new Error("批次名称需为 1 至 80 个字");
  const db = await getAssetDatabase();
  const batch = db.select().from(assetCollections).where(eq(assetCollections.id, batchId)).get();
  const legacy = batch && belongsToLegacyDownloadBatch(batch, projectId, db.select().from(downloadTasks).all());
  if (!batch || batch.kind !== "download-batch" || (batch.projectId !== projectId && !legacy))
    throw new Error("下载批次不存在");
  const result = db.update(assetCollections).set({ name: clean }).where(and(eq(assetCollections.id, batchId),
    eq(assetCollections.kind, "download-batch"))).run();
  if (!result.changes) throw new Error("下载批次不存在");
}

export async function moveOriginalAsset(projectId: string, assetId: string, folderId: string | null) {
  const db = await getAssetDatabase();
  const asset = db.select({ asset: assets }).from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(assets.id, assetId), isNull(assets.deletedAt))).get()?.asset;
  if (!asset) throw new Error("素材不属于当前项目");
  if (["frame-extraction", "frame-stitch", "image-crop", "video-clip", "video-cutting"].includes(asset.sourceType))
    throw new Error("衍生素材不能移入手动文件夹");
  if (folderId) {
    const folder = db.select().from(assetFolders).where(and(eq(assetFolders.id, folderId), eq(assetFolders.projectId, projectId))).get();
    if (!folder) throw new Error("文件夹不存在");
    const category: SourceCategory = ["line", "bilibili"].includes(asset.sourceType) ? "download" : "import";
    if (folder.sourceCategory !== category) throw new Error("素材与文件夹来源分类不一致");
  }
  db.transaction((tx) => {
    tx.delete(assetFolderItems).where(and(eq(assetFolderItems.projectId, projectId), eq(assetFolderItems.assetId, assetId))).run();
    if (folderId) tx.insert(assetFolderItems).values({ projectId, assetId, folderId }).run();
  });
}
