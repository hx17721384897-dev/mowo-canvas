import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../assets/server/schema.ts";
import { VideoTaskStore } from "./task-store.ts";
import { importVideoTask, taskCache, assetCache } from "./import-video.ts";
import { cleanupVideoTask, reconcileVideoFiles } from "./maintenance.ts";
import { requireVideoSpace, videoReserveBytes } from "./space-policy.ts";

const media = { duration: 10, streams: [{ codec_type: "video", codec_name: "h264", width: 320, height: 180, pix_fmt: "yuv420p", color_transfer: "bt709" }], browserCandidate: true };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mowo-maintenance-")); const sql = new Database(join(root, "test.db"));
  sql.pragma("foreign_keys = ON"); const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: "drizzle" });
  db.insert(schema.projects).values({ id: "project", name: "test", createdAt: new Date(), updatedAt: new Date() }).run();
  const store = new VideoTaskStore(db);
  const create = () => store.create("project", { url: "BV1bv411T7et", formatIds: ["1"] });
  async function ready() {
    const task = create(); const run = store.claim("project", task.id);
    const file = join(root, "temp/video-downloads", task.id, "source.mp4"); await mkdir(dirname(file), { recursive: true }); await writeFile(file, "verified original fixture");
    store.applyEvent("project", task.id, run.executionId, { v: 1, event: "downloaded", file: "source.mp4" });
    store.applyEvent("project", task.id, run.executionId, { v: 1, event: "probed", ...media });
    return { task, file };
  }
  return { root, sql, db, store, create, ready, close() { sql.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("cleanup rejects queued and unique ready originals, and cancelled cleanup is repeatable", async () => {
  const f = fixture();
  try {
    const pending = f.create();
    await assert.rejects(cleanupVideoTask(f.db, f.root, "project", pending.id), { code: "INVALID_STATE" });
    f.store.cancelIdle("project", pending.id);
    const directory = join(f.root, "temp/video-downloads", pending.id); await mkdir(directory, { recursive: true }); await writeFile(join(directory, "source.part"), "partial");
    assert.equal((await cleanupVideoTask(f.db, f.root, "project", pending.id)).cleanedDirectories, 1);
    assert.equal((await cleanupVideoTask(f.db, f.root, "project", pending.id)).cleanedDirectories, 0);
    const ready = await f.ready();
    await assert.rejects(cleanupVideoTask(f.db, f.root, "project", ready.task.id), { code: "INVALID_STATE" });
    assert.equal(await readFile(ready.file, "utf8"), "verified original fixture");
  } finally { f.close(); }
});
test("completed cleanup preserves the verified asset, cache and stable URLs", async () => {
  const f = fixture();
  try {
    const ready = await f.ready(); const cache = taskCache(f.root, ready.task.id); await mkdir(cache, { recursive: true }); await writeFile(join(cache, "cover.jpg"), "cover fixture");
    const result = await importVideoTask(f.db, f.root, "project", ready.task.id, async () => media);
    const asset = f.db.select().from(schema.assets).get()!;
    assert.equal((await cleanupVideoTask(f.db, f.root, "project", ready.task.id)).cleanedDirectories, 2);
    assert.equal(await readFile(join(f.root, asset.relativePath!), "utf8"), "verified original fixture");
    assert.equal(await readFile(join(assetCache(f.root, asset.contentHash!), "cover.jpg"), "utf8"), "cover fixture");
    assert.equal(f.store.get("project", ready.task.id).previewUrl, `/api/assets/${result.assetId}/preview`);
    assert.equal((await importVideoTask(f.db, f.root, "project", ready.task.id, async () => media)).assetId, result.assetId);
    await assert.rejects(access(ready.file));
  } finally { f.close(); }
});
test("cleanup refuses a damaged formal original and any junction without deleting task files", async () => {
  const f = fixture();
  try {
    const ready = await f.ready(); await importVideoTask(f.db, f.root, "project", ready.task.id, async () => media);
    const asset = f.db.select().from(schema.assets).get()!;
    await writeFile(join(f.root, asset.relativePath!), "damaged");
    await assert.rejects(cleanupVideoTask(f.db, f.root, "project", ready.task.id), { code: "MEDIA_CHANGED" });
    assert.equal(await readFile(ready.file, "utf8"), "verified original fixture");
    const pending = f.create(); f.store.cancelIdle("project", pending.id);
    const directory = join(f.root, "temp/video-downloads", pending.id); await mkdir(directory, { recursive: true });
    const outside = join(f.root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep"), "sentinel");
    await symlink(outside, join(directory, "junction"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(cleanupVideoTask(f.db, f.root, "project", pending.id), { code: "CLEANUP_FAILED" });
    assert.equal(await readFile(join(outside, "keep"), "utf8"), "sentinel");
  } finally { f.close(); }
});
test("startup marks missing temporary originals for redownload and preserves completed identity", async () => {
  const f = fixture();
  try {
    const missing = await f.ready(); await unlink(missing.file);
    const completed = await f.ready(); await importVideoTask(f.db, f.root, "project", completed.task.id, async () => media);
    const asset = f.db.select().from(schema.assets).get()!; await unlink(join(f.root, asset.relativePath!));
    await reconcileVideoFiles(f.db, f.root);
    assert.equal(f.store.get("project", missing.task.id).status, "failed");
    assert.equal(f.store.get("project", missing.task.id).errorCode, "FILE_MISSING");
    assert.equal(f.store.get("project", completed.task.id).status, "completed");
    assert.equal(f.store.get("project", completed.task.id).assetId, asset.id);
    assert.equal(f.store.get("project", completed.task.id).errorCode, "ASSET_FILE_MISSING");
    const invalid = await f.ready();
    f.db.update(schema.videoDownloadTasks).set({ relativePath: "../outside" }).where(eq(schema.videoDownloadTasks.id, invalid.task.id)).run();
    await reconcileVideoFiles(f.db, f.root);
    assert.equal(f.store.get("project", invalid.task.id).errorCode, "FILE_MISSING");
  } finally { f.close(); }
});
test("disk policy accounts for reserve plus stage estimate without inventing unlimited space", () => {
  requireVideoSpace(videoReserveBytes); requireVideoSpace(videoReserveBytes + 100, 100);
  assert.throws(() => requireVideoSpace(videoReserveBytes - 1), { code: "DISK_FULL" });
  assert.throws(() => requireVideoSpace(videoReserveBytes + 99, 100), { code: "DISK_FULL" });
  assert.throws(() => requireVideoSpace(Infinity), { code: "DISK_FULL" });
});
