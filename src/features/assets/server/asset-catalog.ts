import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { apngFrameCount } from "../downloaders/server/apng";
import { basename, dirname, extname, join, relative } from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AssetProjectSummary, AssetSequence, AssetSummary } from "../types";
import { listProjects } from "@/features/projects/server/project-service";
import { ensureAssetDataPaths, getAssetDataPaths, resolveStoredAssetPath } from "./data-paths";
import { getAssetDatabase } from "./database";
import { assetCollectionItems, assetCollections, assetIntakes, assets, projectAssets, videoClips } from "./schema";
import { assetCache } from "@/features/video-downloads/server/import-video";

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

const supportedImages: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
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
    previewUrl: asset.type === "text" ? null : `/api/assets/${asset.id}/${asset.type === "video" && asset.videoMetadataJson ? "preview" : "content"}`,
    originalUrl: asset.type === "video" ? `/api/assets/${asset.id}/content` : null,
    addedAt: row.addedAt.toISOString(),
  };
}

async function hasAnimation(asset: typeof assets.$inferSelect) {
  if (asset.type !== "image" || !asset.relativePath || asset.sourceType === "frame-extraction") return false;
  try {
    const path = resolveStoredAssetPath(asset.relativePath);
    if (asset.mimeType === "image/png" || asset.mimeType === "image/apng") {
      const file = await open(path, "r");
      try {
        const header = Buffer.alloc(64 * 1024);
        const { bytesRead } = await file.read(header);
        return apngFrameCount(header.subarray(0, bytesRead)) > 1;
      } finally { await file.close(); }
    }
    if (asset.mimeType === "image/gif" || asset.mimeType === "image/webp") {
      return ((await sharp(path, { animated: true }).metadata()).pages ?? 1) > 1;
    }
  } catch { /* An unreadable asset can still be listed. */ }
  return false;
}

export async function listProjectAssets(projectId: string, includeAnimation = false) {
  const database = await getAssetDatabase();
  const rows = database.select({ asset: assets, addedAt: projectAssets.addedAt })
    .from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), isNull(assets.deletedAt)))
    .orderBy(desc(projectAssets.addedAt))
    .all();

  const summaries = rows.map(toSummary);
  const clips = database.select().from(videoClips).where(eq(videoClips.projectId, projectId)).all();
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const sourceById = new Map(rows.map((row) => [row.asset.id, row.asset]));
  for (let index = 0; index < rows.length; index++) {
    const clip = clipById.get(rows[index].asset.id);
    if (!clip) continue;
    const source = sourceById.get(clip.sourceAssetId);
    const startSeconds = clip.startPts * clip.timeBaseNumerator / clip.timeBaseDenominator;
    const endSeconds = clip.endPts * clip.timeBaseNumerator / clip.timeBaseDenominator;
    summaries[index].clip = { sourceAssetId: clip.sourceAssetId, startFrame: clip.startFrame,
      endFrame: clip.endFrame, startSeconds, endSeconds, sequence: clip.sequence };
    summaries[index].duration = endSeconds - startSeconds;
    if (!source || source.deletedAt) { summaries[index].previewUrl = null; summaries[index].originalUrl = null; continue; }
    summaries[index].previewUrl = `/api/assets/${source.id}/${source.videoMetadataJson ? "preview" : "content"}`;
    summaries[index].originalUrl = `/api/assets/${source.id}/content`;
    if (source.contentHash && await access(join(assetCache(getAssetDataPaths().root, source.contentHash), "cover.jpg")).then(() => true, () => false))
      summaries[index].coverUrl = `/api/assets/${source.id}/cover`;
  }
  await Promise.all(rows.map(async ({ asset }, index) => {
    if (asset.type === "video" && asset.contentHash && await access(join(assetCache(getAssetDataPaths().root, asset.contentHash), "cover.jpg")).then(() => true, () => false)) {
      summaries[index].coverUrl = `/api/assets/${asset.id}/cover`;
    }
  }));
  if (includeAnimation) {
    for (let index = 0; index < rows.length; index += 8) {
      await Promise.all(rows.slice(index, index + 8).map(async (row, offset) => {
        summaries[index + offset].animated = await hasAnimation(row.asset);
      }));
    }
  }
  return summaries;
}

export async function listAssetProjects(excludeProjectId?: string): Promise<AssetProjectSummary[]> {
  return (await listProjects(excludeProjectId)).map(({ id, name, assetCount }) => ({ id, name, assetCount }));
}

export async function referenceAssets(projectId: string, assetIds: string[]) {
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

export type ImageBufferImport = {
  buffer: Buffer;
  name: string;
  mimeType: keyof typeof supportedImages;
  sourceType: string;
  sourceUrl?: string;
};

export async function importImageBuffers(projectId: string, sources: ImageBufferImport[], collection?: { name: string; sourceType: string; sourceUrl?: string }) {
  if (sources.length === 0) throw new Error("请选择图片文件");
  if (sources.length > MAX_IMPORT_FILES) throw new Error(`单次最多导入 ${MAX_IMPORT_FILES} 张图片`);

  const paths = await ensureAssetDataPaths();
  const database = await getAssetDatabase();
  const importedIds: string[] = [];
  const intakeIds: string[] = [];

  for (const source of sources) {
    const extension = supportedImages[source.mimeType];
    if (!extension) throw new Error(`不支持的图片格式：${source.name}`);
    if (source.buffer.length > MAX_IMAGE_BYTES) throw new Error(`图片超过 50MB：${source.name}`);

    const buffer = source.buffer;
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
        originalName: basename(source.name, extname(source.name)) + extension,
        relativePath: relative(paths.root, target).replaceAll("\\", "/"),
        mimeType: source.mimeType,
        size: buffer.length,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        contentHash: hash,
        createdAt: new Date(),
      }).run();
    }

    database.insert(projectAssets).values({ projectId, assetId, addedAt: new Date() })
      .onConflictDoNothing().run();
    const intakeId = randomUUID();
    database.insert(assetIntakes).values({ id: intakeId, projectId, assetId, sourceType: source.sourceType,
      sourceName: source.name, sourceUrl: source.sourceUrl, createdAt: new Date() }).run();
    intakeIds.push(intakeId);
    importedIds.push(assetId);
  }

  if (collection && importedIds.length) {
    const collectionId = randomUUID();
    database.insert(assetCollections).values({
      id: collectionId,
      projectId,
      name: collection.name,
      sourceType: collection.sourceType,
      sourceUrl: collection.sourceUrl,
      createdAt: new Date(),
    }).run();
    database.insert(assetCollectionItems).values(importedIds.map((assetId, position) => ({ id: randomUUID(), collectionId, assetId, position })))
      .onConflictDoNothing().run();
    for (const intakeId of intakeIds) database.update(assetIntakes).set({ batchId: collectionId }).where(eq(assetIntakes.id, intakeId)).run();
  }

  return {
    assets: await listProjectAssets(projectId),
    importedIds,
  };
}

export async function importLocalImages(projectId: string, files: File[]) {
  const sources: ImageBufferImport[] = [];
  for (const file of files) {
    if (!(file.type in supportedImages)) throw new Error(`不支持的图片格式：${file.name}`);
    sources.push({
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      mimeType: file.type as keyof typeof supportedImages,
      sourceType: "local",
    });
  }
  return importImageBuffers(projectId, sources);
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
export async function listProjectSequences(projectId: string, projectAssetList: AssetSummary[]): Promise<AssetSequence[]> {
  const database = await getAssetDatabase();
  const rows = database.select({
    id: assetCollections.id, name: assetCollections.name, assetId: assetCollectionItems.assetId, durationMs: assetCollectionItems.durationMs,
  }).from(assetCollections).innerJoin(assetCollectionItems, eq(assetCollections.id, assetCollectionItems.collectionId))
    .where(and(eq(assetCollections.projectId, projectId), eq(assetCollections.kind, "frame-sequence")))
    .orderBy(desc(assetCollections.createdAt), asc(assetCollectionItems.position)).all();
  const assetsById = new Map(projectAssetList.map((asset) => [asset.id, asset]));
  const sequences = new Map<string, AssetSequence>();
  for (const row of rows) {
    const asset = assetsById.get(row.assetId);
    if (!asset) continue;
    const sequence = sequences.get(row.id) ?? { id: row.id, name: row.name, frames: [] };
    sequence.frames.push({ ...asset, durationMs: row.durationMs ?? 100 });
    sequences.set(row.id, sequence);
  }
  return [...sequences.values()];
}
