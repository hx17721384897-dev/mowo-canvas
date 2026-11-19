import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../assets/server/schema.ts";
import { VideoFrameExecutor } from "./video-frame-executor.ts";
import { VideoFrameJobStore } from "./video-frame-job-store.ts";

test("actual queued analysis, extraction, cancellation and restart keep one common draft", async () => {
  const root = await mkdtemp(resolve("data/video-runtime/frame-executor-test-"));
  const sql = new Database(join(root, "db")); sql.pragma("foreign_keys = ON");
  const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: "drizzle" });
  const store = new VideoFrameJobStore(db), executor = new VideoFrameExecutor(store, root);
  async function wait() {
    const deadline = Date.now() + 30000;
    while (executor.busy && Date.now() < deadline) await new Promise((accept) => setTimeout(accept, 30));
    assert.equal(executor.busy, false);
  }
  try {
    await executor.initialize();
    const now = new Date();
    db.insert(schema.projects).values({ id: "p", name: "test", createdAt: now, updatedAt: now }).run();
    await promisify(execFile)(resolve("data/video-runtime/tools/ffmpeg.exe"), ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=48:d=0.25",
      "-c:v", "libx264", join(root, "source.mp4")], { windowsHide: true });
    const bytes = await readFile(join(root, "source.mp4")), hash = createHash("sha256").update(bytes).digest("hex");
    db.insert(schema.assets).values({ id: "v", type: "video", originalName: "source", relativePath: "source.mp4", contentHash: hash,
      sourceType: "local", size: bytes.length, duration: 0.25, createdAt: now }).run();
    db.insert(schema.projectAssets).values({ projectId: "p", assetId: "v", addedAt: now }).run();
    const request = { requestId: randomUUID(), nodeId: "node", mode: "analyze", inputs: [{ assetId: "v" }],
      settings: { restore: true, targetFps: 24, every: 1, keep: 1 } };
    const analysis = store.create("p", request);
    executor.pump(); await wait();
    assert.equal(store.get("p", analysis.id).status, "ready");
    assert.equal(store.get("p", analysis.id).inputs[0].analysis?.estimatedFrameCount, 6);
    assert.equal(db.select().from(schema.frameExtractionTasks).all().length, 0);
    const extractionRequest = { ...request, requestId: randomUUID(), mode: "extract" };
    const extraction = store.create("p", extractionRequest);
    assert.equal(store.create("p", extractionRequest).id, extraction.id);
    executor.pump(); await wait();
    assert.equal(store.get("p", extraction.id).status, "ready", JSON.stringify(store.get("p", extraction.id)));
    const rows = db.select().from(schema.frameExtractionFrames).all();
    assert.equal(rows.length, 6); assert.equal(new Set(rows.map((row) => row.relativePath)).size, 1);
    assert.equal((await readFile(join(root, rows[0].relativePath))).subarray(1, 4).toString(), "PNG");
    const cancelled = store.create("p", { ...request, requestId: randomUUID(), mode: "extract" });
    executor.pump(); store.requestCancel("p", cancelled.id); await wait();
    assert.equal(store.get("p", cancelled.id).status, "cancelled");
    assert.equal(db.select().from(schema.frameExtractionTasks).all().length, 1);
    const orphan = join(root, "temp/frame-extraction", extraction.id, randomUUID());
    await mkdir(orphan, { recursive: true }); await writeFile(join(orphan, "partial.png"), "partial");
    await executor.initialize();
    assert.equal((await readdir(join(root, "temp/frame-extraction", extraction.id))).length, 1);
    assert.ok((await readFile(join(root, rows[0].relativePath))).length > 0);
    assert.equal(db.select().from(schema.frameExtractionSources).all().length, 1);

    await promisify(execFile)(resolve("data/video-runtime/tools/ffmpeg.exe"), ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=48", "-frames:v", "242",
      "-c:v", "libx264", join(root, "long.mp4")], { windowsHide: true });
    const longBytes = await readFile(join(root, "long.mp4"));
    db.insert(schema.assets).values({ id: "long", type: "video", originalName: "long", relativePath: "long.mp4",
      contentHash: createHash("sha256").update(longBytes).digest("hex"), sourceType: "local", size: longBytes.length, duration: 242 / 48, createdAt: now }).run();
    db.insert(schema.projectAssets).values({ projectId: "p", assetId: "long", addedAt: now }).run();
    const mixed = store.create("p", { requestId: randomUUID(), nodeId: "mixed", mode: "extract",
      settings: { restore: false, every: 1, keep: 1, deferOutput: true }, inputs: [{ assetId: "v" }, { assetId: "long" }] });
    executor.pump(); await wait();
    const waiting = store.get("p", mixed.id);
    assert.equal(waiting.inputs[0].status, "ready");
    assert.equal(waiting.inputs[1].status, "analyzed");
    assert.equal(waiting.inputs[1].analysis?.estimatedFrameCount, 242);
    assert.equal(waiting.inputs[1].analysis?.issue, "OUTPUT_LIMIT");
    const originalTaskId = waiting.resultTaskId;
    const confirmation = { action: "confirm", inputs: [{ assetId: "long", settings: { restore: false, every: 2, keep: 1, deferOutput: true } }] };
    store.confirm("p", mixed.id, confirmation);
    assert.equal(store.confirm("p", mixed.id, confirmation).id, mixed.id);
    executor.pump(); await wait();
    const completed = store.get("p", mixed.id);
    assert.equal(completed.resultTaskId, originalTaskId);
    assert.ok(completed.inputs.every(input => input.status === "ready"));
    assert.equal(completed.inputs[1].analysis?.estimatedFrameCount, 121);
    store.confirm("p", mixed.id, confirmation);
    assert.equal(db.select().from(schema.frameExtractionTasks).all().length, 2);
    assert.equal(db.select().from(schema.frameExtractionSources).all().length, 3);

    const uncertain = store.create("p", { requestId: randomUUID(), nodeId: "uncertain", mode: "extract", inputs: [{ assetId: "v" }],
      settings: { restore: true, every: 1, keep: 1, deferOutput: true } });
    executor.pump(); await wait();
    assert.equal(store.get("p", uncertain.id).inputs[0].analysis?.issue, "TARGET_FPS_REQUIRED");
    assert.equal(store.get("p", uncertain.id).resultTaskId, null);
    await executor.initialize();
    store.confirm("p", uncertain.id, { action: "confirm", inputs: [{ assetId: "v", settings: { restore: true, targetFps: 24, every: 1, keep: 1, deferOutput: true } }] });
    executor.pump(); await wait();
    assert.equal(store.get("p", uncertain.id).inputs[0].analysis?.estimatedFrameCount, 6);
    assert.equal(store.get("p", uncertain.id).inputs[0].status, "ready");
  } finally { await executor.stop(); sql.close(); await rm(root, { recursive: true, force: true }); }
});
