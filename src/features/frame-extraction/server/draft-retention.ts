import { readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only directories without a database task can be removed automatically. */
export async function cleanupOrphanedFrameFiles(root: string, activeTaskIds: ReadonlySet<string>, now = Date.now()) {
  const rootPath = resolve(root);
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !TASK_ID_PATTERN.test(entry.name) || activeTaskIds.has(entry.name)) continue;
    const target = resolve(join(rootPath, entry.name));
    if (relative(rootPath, target) !== entry.name) continue;
    try {
      if (now - (await stat(target)).mtimeMs < ORPHAN_GRACE_MS) continue;
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}
