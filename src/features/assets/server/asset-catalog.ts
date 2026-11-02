import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { AssetProjectSummary, AssetSummary } from "../types";
import { ensureAssetDataPaths, getAssetDataPaths, resolveStoredAssetPath } from "./data-paths";
import { getAssetDatabase } from "./database";
import { assets, projectAssets, projects } from "./schema";

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

const supportedImages: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const knownProjects: Record<string, string> = {
  "emoji-workflow": "表情包工作流",
  storyboard: "动画分镜整理",
  "brand-assets": "品牌素材处理",
  "video-notes": "视频灵感与脚本",
  "product-research": "产品调研画布",
  "weekly-plan": "本周工作规划",
  new: "未命名画布",
};

function toSummary(row: {
  asset: typeof assets.$inferSelect;
  addedAt: Date;
}): AssetSummary {
  const asset = row.asset;
  return {
    id: asset.id,
    type: asset.type,
    name: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    sourceType: asset.sourceType,
    previewUrl: asset.type === "text" ? null : `/api/assets/${asset.id}/content`,
    addedAt: row.addedAt.toISOString(),
  };
}

async function ensureKnownProjects() {
  const database = await getAssetDatabase();
  const now = new Date();
  database.insert(projects).values(
    Object.entries(knownProjects).map(([id, name]) => ({ id, name, createdAt: now, updatedAt: now })),
  ).onConflictDoNothing().run();
}

export async function listProjectAssets(projectId: string) {
  await ensureKnownProjects();
  const database = await getAssetDatabase();
  const rows = database.select({ asset: assets, addedAt: projectAssets.addedAt })
    .from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), isNull(assets.deletedAt)))
    .orderBy(desc(projectAssets.addedAt))
    .all();

  return rows.map(toSummary);
}

export async function listAssetProjects(excludeProjectId?: string): Promise<AssetProjectSummary[]> {
  await ensureKnownProjects();
  const database = await getAssetDatabase();
  const where = excludeProjectId ? ne(projects.id, excludeProjectId) : undefined;
  const rows = database.select({
    id: projects.id,
    name: projects.name,
    assetCount: count(projectAssets.assetId),
  }).from(projects)
    .leftJoin(projectAssets, eq(projects.id, projectAssets.projectId))
    .where(where)
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt))
    .all();

  return rows;
}

export async function referenceAssets(projectId: string, assetIds: string[]) {
  await ensureKnownProjects();
  if (assetIds.length === 0) return listProjectAssets(projectId);

  const database = await getAssetDatabase();
  const validAssets = database.select({ id: assets.id }).from(assets)
    .where(and(inArray(assets.id, assetIds), isNull(assets.deletedAt)))
    .all();
  const now = new Date();

  database.insert(projectAssets).values(
    validAssets.map(({ id }) => ({ projectId, assetId: id, addedAt: now })),
  ).onConflictDoNothing().run();

  return listProjectAssets(projectId);
}

export async function importLocalImages(projectId: string, files: File[]) {
  await ensureKnownProjects();
  if (files.length === 0) throw new Error("请选择图片文件");
  if (files.length > MAX_IMPORT_FILES) throw new Error(`单次最多导入 ${MAX_IMPORT_FILES} 张图片`);

  const paths = await ensureAssetDataPaths();
  const database = await getAssetDatabase();
  const importedIds: string[] = [];

  for (const file of files) {
    const extension = supportedImages[file.type];
    if (!extension) throw new Error(`不支持的图片格式：${file.name}`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`图片超过 50MB：${file.name}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");
    const existing = database.select().from(assets).where(eq(assets.contentHash, hash)).get();
    let assetId = existing?.id;

    if (!assetId) {
      assetId = randomUUID();
      const target = join(/* turbopackIgnore: true */ paths.imageOriginals, hash.slice(0, 2), `${hash}${extension}`);
      const temporary = join(/* turbopackIgnore: true */ paths.tempImports, `${randomUUID()}${extension}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporary, buffer, { flag: "wx" });
      try {
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }

      database.insert(assets).values({
        id: assetId,
        type: "image",
        originalName: basename(file.name, extname(file.name)) + extension,
        relativePath: relative(paths.root, target).replaceAll("\\", "/"),
        mimeType: file.type,
        size: file.size,
        sourceType: "local",
        contentHash: hash,
        createdAt: new Date(),
      }).run();
    }

    database.insert(projectAssets).values({ projectId, assetId, addedAt: new Date() })
      .onConflictDoNothing().run();
    importedIds.push(assetId);
  }

  return {
    assets: await listProjectAssets(projectId),
    importedIds,
  };
}

export async function getAssetContent(assetId: string) {
  const database = await getAssetDatabase();
  const asset = database.select().from(assets)
    .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
    .get();

  if (!asset?.relativePath || !asset.mimeType) return null;
  return {
    path: resolveStoredAssetPath(asset.relativePath),
    mimeType: asset.mimeType,
    name: asset.originalName,
  };
}

export function getDataRootForDiagnostics() {
  return getAssetDataPaths().root;
}
