import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { cleanupOrphanedFrameFiles } from "./draft-retention.ts";

const root = await mkdtemp(join(tmpdir(), "mowo-frame-retention-"));
const retained = "11111111-1111-4111-8111-111111111111";
const orphan = "22222222-2222-4222-8222-222222222222";
const fresh = "33333333-3333-4333-8333-333333333333";
const now = Date.now();
try {
  for (const id of [retained, orphan, fresh]) {
    await mkdir(join(root, id));
    await writeFile(join(root, id, "0001.png"), "frame");
  }
  const yesterday = new Date(now - 2 * 24 * 60 * 60 * 1000);
  await utimes(join(root, retained), yesterday, yesterday);
  await utimes(join(root, orphan), yesterday, yesterday);
  await cleanupOrphanedFrameFiles(root, new Set([retained]), now);
  assert.deepEqual((await readdir(root)).sort(), [fresh, retained].sort());
  assert.deepEqual(await readdir(join(root, retained)), ["0001.png"]);
  console.log("Frame draft retention tests passed");
} finally {
  if (relative(resolve(tmpdir()), resolve(root)).startsWith("mowo-frame-retention-")) {
    await rm(root, { recursive: true, force: true });
  }
}
