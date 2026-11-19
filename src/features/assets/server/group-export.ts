import "server-only";

import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { cleanExportName, uniqueExportPath } from "../group-export-zip";
import { resolveStoredAssetPath } from "./data-paths";
import { getAssetDatabase } from "./database";
import { assets, projectAssets } from "./schema";

export type GroupExportRequest = { assetId: string; directories: string[]; order?: number };
const MAX_ENTRIES = 1000;
const MAX_BYTES = 2_000_000_000;

export { cleanExportName } from "../group-export-zip";

export async function prepareGroupExport(projectId: string, entries: GroupExportRequest[]) {
  if (!projectId || !Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) throw new Error("请选择包含 1 至 1000 个文件的组");
  if (entries.some((entry) => !entry || typeof entry.assetId !== "string" || !Array.isArray(entry.directories) || entry.directories.length > 8
    || entry.directories.some((part) => typeof part !== "string" || part.length > 100)
    || (entry.order !== undefined && (!Number.isInteger(entry.order) || entry.order < 1 || entry.order > MAX_ENTRIES)))) throw new Error("导出清单无效");
  const database = await getAssetDatabase();
  const linked = database.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, projectId), inArray(assets.id, [...new Set(entries.map((entry) => entry.assetId))]), isNull(assets.deletedAt))).all();
  const byId = new Map(linked.map(({ asset }) => [asset.id, asset]));
  const used = new Set<string>();
  let total = 0;
  const files = [];
  for (const entry of entries) {
    const asset = byId.get(entry.assetId);
    if (!asset?.relativePath || (asset.type !== "image" && asset.type !== "video")) throw new Error("组内存在无法导出的素材");
    const path = resolveStoredAssetPath(asset.relativePath);
    const file = await stat(path).catch(() => { throw new Error("组内素材文件缺失，请检查资产库"); });
    if (!file.isFile()) throw new Error("组内素材文件无效");
    total += file.size;
    if (total > MAX_BYTES) throw new Error("压缩包超过 2 GB，请拆成较小的组导出");
    const extension = extname(asset.originalName) || (asset.type === "video" ? ".mp4" : ".png");
    const filename = entry.order === undefined ? cleanExportName(asset.originalName) : `${String(entry.order).padStart(3, "0")}${extension}`;
    const name = uniqueExportPath([...entry.directories.map(cleanExportName), filename].join("/"), used);
    files.push({ path, name });
  }
  return files;
}

export { streamGroupZip } from "../group-export-zip";
