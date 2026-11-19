import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../assets/server/schema.ts";
import { VideoTaskStore, VideoTaskError } from "./task-store.ts";

const input = { url: "https://www.bilibili.com/video/BV1bv411T7et/?p=2&spm_id_from=tracking", formatIds: ["30080", "30280"] };
const media = { duration: 136, streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, pix_fmt: "yuv420p", color_transfer: "bt709" }], browserCandidate: false };
const error = (code: string) => (value: unknown) => value instanceof VideoTaskError && value.code === code;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mowo-video-task-"));
  const filename = join(root, "test.db"); const sql = new Database(filename);
  sql.pragma("foreign_keys = ON"); sql.pragma("journal_mode = WAL");
  const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: "drizzle" });
  for (const id of ["a", "b"]) db.insert(schema.projects).values({ id, name: id, createdAt: new Date(), updatedAt: new Date() }).run();
  return { root, filename, sql, db, store: new VideoTaskStore(db), close() { sql.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("video migration preserves existing LINE tasks", () => {
  const root = mkdtempSync(join(tmpdir(), "mowo-video-migration-")); const sql = new Database(join(root, "legacy.db"));
  try {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const index = journal.entries.find((entry: { tag: string }) => entry.tag === "0006_video-download-tasks").idx;
    const old = join(root, "old"); mkdirSync(join(old, "meta"), { recursive: true });
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < index);
    writeFileSync(join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(old, `${entry.tag}.sql`));
    const db = drizzle(sql, { schema }); migrate(db, { migrationsFolder: old });
    sql.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES ('a','legacy',0,0)").run();
    sql.prepare("INSERT INTO download_tasks(id,project_id,platform,source_url,status,created_at,updated_at) VALUES ('line','a','line','https://store.line.me/example','ready',0,0)").run();
    migrate(db, { migrationsFolder: "drizzle" });
    assert.deepEqual(sql.prepare("SELECT platform,status FROM download_tasks WHERE id='line'").get(), { platform: "line", status: "ready" });
    assert.equal(new VideoTaskStore(db).create("a", input).status, "queued");
  } finally { sql.close(); rmSync(root, { recursive: true, force: true }); }
});

test("records survive a new connection and summaries exclude internal paths/tokens", () => {
  const f = fixture();
  try {
    const task = f.store.create("a", input); const claimed = f.store.claim("a", task.id);
    f.store.applyEvent("a", task.id, claimed.executionId, { v: 1, event: "downloaded", file: "source.mp4" });
    const connection = new Database(f.filename);
    try {
      const other = new VideoTaskStore(drizzle(connection, { schema })); const saved = other.get("a", task.id);
      assert.equal(saved.status, "verifying"); assert.equal(saved.part, 2);
      assert.equal(saved.sourceUrl, "https://www.bilibili.com/video/BV1bv411T7et?p=2");
      assert.ok(!JSON.stringify(saved).includes(claimed.executionId)); assert.ok(!JSON.stringify(saved).includes("temp/video-downloads"));
    } finally { connection.close(); }
  } finally { f.close(); }
});

test("two connections share a single active task and running cancellation requires worker confirmation", () => {
  const f = fixture(); const connection = new Database(f.filename);
  try {
    const other = new VideoTaskStore(drizzle(connection, { schema }));
    const one = f.store.create("a", input), two = other.create("b", input);
    const run = f.store.claim("a", one.id);
    assert.throws(() => other.claim("b", two.id), error("TASK_BUSY"));
    assert.throws(() => f.store.cancelIdle("a", one.id), error("TASK_BUSY"));
    assert.ok(f.store.cancelExecution("a", one.id, run.executionId));
    assert.equal(other.claim("b", two.id).task.status, "downloading");
  } finally { connection.close(); f.close(); }
});

test("retry changes the execution identity and ignores late events", () => {
  const f = fixture();
  try {
    const task = f.store.create("a", input); const old = f.store.claim("a", task.id);
    f.store.applyEvent("a", task.id, old.executionId, { v: 1, event: "failed", code: "platform_rejected" });
    assert.equal(f.store.retry("a", task.id).retryCount, 1);
    assert.equal(f.store.retry("a", task.id).retryCount, 1);
    const current = f.store.claim("a", task.id); assert.notEqual(old.executionId, current.executionId);
    assert.equal(f.store.applyEvent("a", task.id, old.executionId, { secret: "late" }), false);
    assert.equal(f.store.cancelExecution("a", task.id, old.executionId), false);
    assert.equal(f.store.get("a", task.id).status, "downloading");
  } finally { f.close(); }
});

test("media validation, preview failure and done never pretend the asset has been imported", () => {
  const f = fixture();
  try {
    const task = f.store.create("a", input); const { executionId } = f.store.claim("a", task.id);
    assert.throws(() => f.store.applyEvent("a", task.id, executionId, { v: 1, event: "downloaded", file: "../../private.mp4" }), error("INVALID_EVENT"));
    f.store.applyEvent("a", task.id, executionId, { v: 1, event: "downloaded", file: "source.mp4" });
    assert.throws(() => f.store.applyEvent("a", task.id, executionId, { v: 1, event: "probed", ...media, streams: [] }), error("INVALID_EVENT"));
    f.store.applyEvent("a", task.id, executionId, { v: 1, event: "probed", ...media });
    f.store.applyEvent("a", task.id, executionId, { v: 1, event: "done" });
    assert.equal(f.store.get("a", task.id).status, "ready"); assert.equal(f.store.get("a", task.id).assetId, null);
    assert.throws(() => f.store.cancelIdle("a", task.id), error("INVALID_STATE"));
    const previewId = f.store.beginPreview("a", task.id);
    f.store.applyEvent("a", task.id, previewId, { v: 1, event: "failed", code: "hdr_preview_requires_tonemapping" });
    assert.equal(f.store.get("a", task.id).status, "ready");
    assert.equal(f.store.get("a", task.id).errorCode, "HDR_PREVIEW_UNSUPPORTED");
    const retry = f.store.beginPreview("a", task.id);
    f.store.applyEvent("a", task.id, retry, { v: 1, event: "previewed", ...media, browserCandidate: true });
    assert.equal(f.store.get("a", task.id).previewStatus, "ready");
  } finally { f.close(); }
});

test("startup interrupts unfinished work but preserves verified files for manual import", () => {
  const f = fixture();
  try {
    const ready = f.store.create("a", input), queued = f.store.create("b", input);
    const run = f.store.claim("a", ready.id);
    f.store.applyEvent("a", ready.id, run.executionId, { v: 1, event: "downloaded", file: "source.mp4" });
    f.store.applyEvent("a", ready.id, run.executionId, { v: 1, event: "probed", ...media });
    f.store.beginPreview("a", ready.id);
    assert.equal(f.store.interruptPending(), 2);
    assert.equal(f.store.get("a", ready.id).status, "ready"); assert.equal(f.store.get("a", ready.id).previewStatus, "failed");
    assert.equal(f.store.get("b", queued.id).status, "interrupted");
    assert.equal(f.store.retry("b", queued.id).status, "queued");
  } finally { f.close(); }
});

test("project scope and untrusted create inputs are enforced", () => {
  const f = fixture();
  try {
    const task = f.store.create("a", input);
    assert.throws(() => f.store.get("b", task.id), error("TASK_NOT_FOUND"));
    assert.throws(() => f.store.retry("b", task.id), error("TASK_NOT_FOUND"));
    for (const url of ["http://www.bilibili.com/video/BV1bv411T7et", "https://bilibili.com.evil/video/BV1bv411T7et", "https://user:secret@bilibili.com/video/BV1bv411T7et", "https://bilibili.com/video/BV1bv411T7et?p=1&p=2"])
      assert.throws(() => f.store.create("a", { ...input, url }), error("INVALID_INPUT"));
    assert.throws(() => f.store.create("a", { ...input, status: "completed" }), error("INVALID_INPUT"));
    assert.throws(() => f.store.create("a", { ...input, formatIds: ["30080", "30080"] }), error("INVALID_INPUT"));
    assert.equal(f.store.list("a").length, 1); assert.deepEqual(f.store.list("b"), []);
  } finally { f.close(); }
});
