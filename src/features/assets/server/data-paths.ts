import "server-only";

import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

export type AssetDataPaths = {
  root: string;
  database: string;
  imageOriginals: string;
  tempImports: string;
  trash: string;
  backups: string;
};

export function getAssetDataPaths(): AssetDataPaths {
  const configuredRoot = process.env.MOWO_DATA_ROOT?.trim();
  const root = configuredRoot
    ? resolve(configuredRoot)
    : join(homedir(), "Documents", "MOWO Canvas Data");

  return {
    root,
    database: join(root, "database", "mowo.db"),
    imageOriginals: join(root, "storage", "originals", "images"),
    tempImports: join(root, "temp", "imports"),
    trash: join(root, "trash"),
    backups: join(root, "backups"),
  };
}

export async function ensureAssetDataPaths() {
  const paths = getAssetDataPaths();
  await Promise.all([
    mkdir(join(paths.root, "database"), { recursive: true }),
    mkdir(paths.imageOriginals, { recursive: true }),
    mkdir(paths.tempImports, { recursive: true }),
    mkdir(paths.trash, { recursive: true }),
    mkdir(paths.backups, { recursive: true }),
  ]);
  return paths;
}

export function resolveStoredAssetPath(relativePath: string) {
  const { root } = getAssetDataPaths();
  const target = resolve(root, ...normalize(relativePath).split(/[\\/]+/));
  const fromRoot = relative(root, target);

  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("资产路径超出数据目录");
  }

  return target;
}
