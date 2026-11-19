import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../assets/server/schema.ts";
import { VideoFrameJobStore } from "./video-frame-job-store.ts";
import type { VideoFrameResult } from "../video-frame-result.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "video-frame-jobs-"));
  const sql = new Database(join(root, "db"));
  sql.pragma("foreign_keys = ON");
  const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: "drizzle" });
  const now = new Date();
  for (const id of ["a", "b"]) db.insert(schema.projects).values({ id, name: id, createdAt: now, updatedAt: now }).run();
  for (const id of ["video1", "video2"]) {
    db.insert(schema.assets).values({ id, type: "video", originalName: id, sourceType: "local", createdAt: now }).run();
    db.insert(schema.projectAssets).values({ projectId: "a", assetId: id, addedAt: now }).run();
  }
  const store = new VideoFrameJobStore(db);
  const result: VideoFrameResult = { algorithmVersion: 1, sourceKind: "video", sourceContentHash: "a".repeat(64),
    width: 64, height: 64, durationMs: 250, preparedBytes: 1000, sourceStartFrame: 0, sourceEndFrame: 12,
    sourceStartPts: 0, sourceEndPts: 12, timeBaseNumerator: 1, timeBaseDenominator: 48,
    restore: true, targetFps: 24, every: 1, keep: 1, recommendation: { status: "uncertain", suggestedFps: null },
    issue: null, estimatedFrameCount: 6, timingErrorMs: 0, holds: [], metrics: [],
    frames: Array.from({ length: 6 }, (_, i) => ({ position: i, sourcePosition: 0, sourceStartFrame: 0,
      sourceEndFrame: 12, sourcePts: 0, timelineStartMs: i * 250 / 6, durationMs: 250 / 6, file: "source-000000.png" })) };
  const body = (extra = {}) => ({ requestId: randomUUID(), nodeId: "node", mode: "extract", inputs: [{ assetId: "video1" }], ...extra });
  return { root, sql, db, store, result, body, close() { sql.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("repeated creation is idempotent, conflicts rejected, project ownership enforced", () => {
  const f = fixture();
  const otherSql = new Database(join(f.root, "db"));
  const other = new VideoFrameJobStore(drizzle(otherSql, { schema }));
  try {
    const request = f.body(), job = f.store.create("a", request);
    assert.equal(other.create("a", request).id, job.id);
    assert.equal(f.db.select().from(schema.frameExtractionTasks).all().length, 0);
    assert.throws(() => other.create("a", { ...request, mode: "analyze" }), { code: "REQUEST_CONFLICT" });
    assert.throws(() => other.create("a", f.body()), { code: "NODE_BUSY" });
    assert.throws(() => f.store.create("b", f.body()), { code: "VIDEO_UNAVAILABLE" });
    assert.throws(() => f.store.get("b", job.id), { code: "JOB_NOT_FOUND" });
    assert.equal(f.store.claimNext()?.job.id, job.id);
    assert.equal(other.claimNext(), null);
  } finally { otherSql.close(); f.close(); }
});

test("publication creates one common draft, keeps independent frame IDs and cumulative timing", () => {
  const f = fixture();
  try {
    const job = f.store.create("a", f.body()), execution = f.store.claimNext()!;
    const source = randomUUID(), paths = f.result.frames.map(() => "draft/shared.png");
    assert.equal(f.store.publish("a", job.id, execution.executionId, 0, f.result, source, paths), source);
    assert.equal(f.store.publish("a", job.id, execution.executionId, 0, f.result, randomUUID(), paths), source);
    const rows = f.db.select().from(schema.frameExtractionFrames).all();
    assert.equal(rows.length, 6); assert.equal(new Set(rows.map((row) => row.id)).size, 6);
    assert.equal(rows.reduce((sum, row) => sum + row.durationMs, 0), 250);
    assert.equal(f.db.select().from(schema.frameExtractionSources).all().length, 1);
    f.store.finish("a", job.id, execution.executionId);
    assert.equal(f.store.get("a", job.id).resultTaskId, job.id);
    assert.equal(f.store.get("a", job.id).status, "ready");
  } finally { f.close(); }
});

test("partial retry preserves success, fences late execution and does not duplicate drafts", () => {
  const f = fixture();
  try {
    const job = f.store.create("a", f.body({ inputs: [{ assetId: "video1" }, { assetId: "video2" }] }));
    const first = f.store.claimNext()!;
    f.store.publish("a", job.id, first.executionId, 0, f.result, randomUUID(), f.result.frames.map(() => "a.png"));
    f.store.patchInput("a", job.id, first.executionId, 1, { status: "failed", errorCode: "DECODE_FAILED" });
    f.store.finish("a", job.id, first.executionId);
    assert.equal(f.store.get("a", job.id).status, "partial");
    f.store.retry("a", job.id); f.store.retry("a", job.id);
    const second = f.store.claimNext()!;
    assert.notEqual(second.executionId, first.executionId);
    assert.throws(() => f.store.publish("a", job.id, first.executionId, 1, f.result, randomUUID(), []), { code: "STALE_EXECUTION" });
    f.store.publish("a", job.id, second.executionId, 1, f.result, randomUUID(), f.result.frames.map(() => "b.png"));
    f.store.finish("a", job.id, second.executionId);
    assert.equal(f.store.get("a", job.id).status, "ready");
    assert.equal(f.db.select().from(schema.frameExtractionTasks).all().length, 1);
    assert.equal(f.db.select().from(schema.frameExtractionSources).all().length, 2);
    const rerun = f.store.create("a", f.body());
    assert.notEqual(rerun.id, job.id);
    assert.equal(f.db.select().from(schema.frameExtractionTasks).all().length, 1); // queued rerun has no draft yet
  } finally { f.close(); }
});

test("cancel and restart preserve completed sources and analysis creates no draft", () => {
  const f = fixture();
  try {
    const canceled = f.store.create("a", f.body());
    f.store.requestCancel("a", canceled.id);
    assert.equal(f.store.get("a", canceled.id).status, "cancelled");
    const analyzed = f.store.create("a", f.body({ mode: "analyze" }));
    const execution = f.store.claimNext()!;
    f.store.patchInput("a", analyzed.id, execution.executionId, 0, { status: "analyzed" });
    f.store.finish("a", analyzed.id, execution.executionId);
    assert.equal(f.db.select().from(schema.frameExtractionTasks).all().length, 0);
    const interrupted = f.store.create("a", f.body());
    f.store.claimNext(); f.store.interruptPending();
    assert.equal(f.store.get("a", interrupted.id).errorCode, "INTERRUPTED");
    assert.equal(f.store.get("a", interrupted.id).status, "failed");
    assert.equal(f.db.select().from(schema.frameExtractionTasks).all().length, 0);
  } finally { f.close(); }
});
