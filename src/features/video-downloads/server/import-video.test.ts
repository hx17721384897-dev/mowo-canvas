import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../assets/server/schema.ts";
import { VideoTaskStore } from "./task-store.ts";
import { importVideoTask, assetCache, taskCache, syncVideoCache, insideVideoRoot } from "./import-video.ts";

const media = { duration: 600, streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, pix_fmt: "yuv420p", color_transfer: "bt709" }], browserCandidate: false };
const bytes = Buffer.alloc(65536, 42);
const hash = createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mowo-video-import-")); const sql = new Database(join(root, "db"));
  sql.pragma("foreign_keys = ON");
  const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: "drizzle" });
  const store = new VideoTaskStore(db);
  for (const id of ["a", "b"]) db.insert(schema.projects).values({ id, name: id, createdAt: new Date(), updatedAt: new Date() }).run();
  async function ready(projectId = "a", url = "BV1bv411T7et") {
    const task = store.create(projectId, { url, formatIds: ["1"] }); const run = store.claim(projectId, task.id);
    const source = join(root, "temp/video-downloads", task.id, "source.mp4"); await mkdir(dirname(source), { recursive: true }); await writeFile(source, bytes);
    store.applyEvent(projectId, task.id, run.executionId, { v: 1, event: "downloaded", file: "source.mp4" });
    store.applyEvent(projectId, task.id, run.executionId, { v: 1, event: "probed", ...media });
    return { task, source };
  }
  return { root, sql, db, store, ready, close() { sql.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("file import is idempotent, keeps original and links identical content across projects", async () => {
  const f = fixture();
  try {
    const one = await f.ready();
    const result = await importVideoTask(f.db, f.root, "a", one.task.id, async () => media);
    assert.equal(result.task.status, "completed"); assert.equal(result.task.media?.duration, 600); // Download import has no local-upload 5-minute limit.
    assert.deepEqual(await readFile(one.source), bytes);
    assert.equal((await importVideoTask(f.db, f.root, "a", one.task.id, async () => { throw new Error(); })).assetId, result.assetId);
    const two = await f.ready("b", "BV1xx411c7mu");
    const again = await importVideoTask(f.db, f.root, "b", two.task.id, async () => media);
    assert.equal(again.assetId, result.assetId);
    assert.equal(f.sql.prepare<[], { n: number }>("SELECT count(*) AS n FROM assets").get()?.n, 1);
    assert.equal(f.sql.prepare<[], { n: number }>("SELECT count(*) AS n FROM project_assets").get()?.n, 2);
    assert.notEqual(again.task.sourceUrl, result.task.sourceUrl);
    const asset = f.db.select().from(schema.assets).get()!;
    assert.equal(asset.sourceType, "bilibili"); assert.equal(asset.sourceUrl, result.task.sourceUrl); assert.equal(asset.contentHash, hash);
    assert.deepEqual(await readFile(join(f.root, asset.relativePath!)), bytes);
  } finally { f.close(); }
});

test("preview can finish after import without losing its execution identity or overwriting the original", async () => {
  const f = fixture();
  try {
    const one = await f.ready(); const execution = f.store.beginPreview("a", one.task.id);
    const result = await importVideoTask(f.db, f.root, "a", one.task.id, async () => media);
    assert.equal(result.task.previewStatus, "generating");
    assert.equal(f.store.executionSource("a", one.task.id).executionId, execution);
    const cache = taskCache(f.root, one.task.id); await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "preview.mp4"), "verified preview fixture");
    f.store.applyEvent("a", one.task.id, execution, { v: 1, event: "previewed", ...media, browserCandidate: true });
    await syncVideoCache(f.db, f.root, "a", one.task.id);
    assert.equal(f.store.get("a", one.task.id).status, "completed");
    assert.equal(f.store.get("a", one.task.id).previewStatus, "ready");
    assert.equal(await readFile(join(assetCache(f.root, hash), "preview.mp4"), "utf8"), "verified preview fixture");
    assert.deepEqual(await readFile(one.source), bytes);
  } finally { f.close(); }
});

test("failed database submission keeps the source and a later retry reuses a verified orphan file", async () => {
  const f = fixture();
  try {
    const one = await f.ready();
    await assert.rejects(importVideoTask(f.db, f.root, "a", one.task.id, async () => { f.store.discard("a", one.task.id); return media; }), { code: "INVALID_STATE" });
    assert.equal(f.sql.prepare<[], { n: number }>("SELECT count(*) AS n FROM assets").get()?.n, 0);
    assert.deepEqual(await readFile(one.source), bytes);
    const published = join(f.root, "storage/originals/videos", hash.slice(0, 2), `${hash}.mp4`);
    assert.equal((await stat(published)).size, bytes.length);
    f.db.update(schema.videoDownloadTasks).set({ status: "ready" }).where(eq(schema.videoDownloadTasks.id, one.task.id)).run();
    const result = await importVideoTask(f.db, f.root, "a", one.task.id, async () => media);
    assert.equal(result.task.status, "completed");
    assert.equal(f.store.executionSource("a", one.task.id).relativePath, relative(f.root, published));
  } finally { f.close(); }
});

test("missing, changed or conflicting files never become assets and existing data is not overwritten", async () => {
  const f = fixture();
  try {
    const one = await f.ready();
    await assert.rejects(importVideoTask(f.db, f.root, "a", one.task.id, async () => ({ ...media, duration: 100 })), { code: "MEDIA_CHANGED" });
    const target = join(f.root, "storage/originals/videos", hash.slice(0, 2), `${hash}.mp4`); await mkdir(dirname(target), { recursive: true }); await writeFile(target, "do not overwrite");
    await assert.rejects(importVideoTask(f.db, f.root, "a", one.task.id, async () => media), { code: "IMPORT_FAILED" });
    assert.equal(await readFile(target, "utf8"), "do not overwrite");
    assert.equal(f.store.get("a", one.task.id).status, "ready");
    assert.equal(f.sql.prepare<[], { n: number }>("SELECT count(*) AS n FROM assets").get()?.n, 0);
    await import("node:fs/promises").then(fs => fs.unlink(one.source));
    await assert.rejects(importVideoTask(f.db, f.root, "a", one.task.id, async () => media), { code: "FILE_MISSING" });
    assert.throws(() => insideVideoRoot(f.root, "../outside"), { code: "FILE_MISSING" });
  } finally { f.close(); }
});
