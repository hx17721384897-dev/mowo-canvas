import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { LEASE_MS, RunError, RunStore } from "./run-store.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mowo-ai-runs-")), file = join(root, "test.db");
  const store = new RunStore(file);
  store.db.pragma("journal_mode = WAL");
  migrate(drizzle(store.db), { migrationsFolder: join(process.cwd(), "drizzle") });
  store.db.prepare("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('test-project','AI测试',0,0)").run();
  return { store, file, cleanup() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const code = (expected: string) => (error: unknown) => error instanceof RunError && error.code === expected;
async function worker(file: string, operation: string, production = false) {
  const script = production ? "scripts/ai-run-worker.ts" : "scripts/ai-run-test-worker.ts";
  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", script, file, operation], {
    windowsHide: true, env: { ...process.env, DEEPSEEK_API_KEY: "" },
  });
  let output = "", errors = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Worker timeout")); }, 10000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (status) => { clearTimeout(timeout); if (status === 0) resolve(); else reject(new Error(errors)); });
  });
  return output.trim();
}

test("幂等、项目归属、同画布并发和消息原子保存", () => {
  const f = fixture();
  try {
    const a = f.store.create("test-project", "request-0001", "你好");
    assert.equal(f.store.create("test-project", "request-0001", "你好").run.id, a.run.id);
    assert.throws(() => f.store.create("test-project", "request-0001", "另一条"), code("REQUEST_CONFLICT"));
    assert.throws(() => f.store.create("test-project", "request-0002", "新消息"), code("RUN_ACTIVE"));
    assert.throws(() => f.store.find("missing-project", "request-0001"), code("PROJECT_NOT_FOUND"));
    assert.equal(f.store.history("test-project").length, 2);
    f.store.finish(a.run.id, "stopped");
    assert.equal(f.store.finish(a.run.id, "completed"), false);
    assert.equal(f.store.get(a.run.id).status, "stopped");
    assert.equal(f.store.finish(a.run.id, "stopped"), false);
    f.store.db.prepare("DELETE FROM projects WHERE id='test-project'").run();
    assert.equal(f.store.db.prepare("SELECT * FROM ai_messages").all().length, 0);
    assert.equal(f.store.db.prepare("SELECT * FROM ai_events").all().length, 0);
  } finally { f.cleanup(); }
});

test("租约到期拒绝旧实例写入，重启核对保留部分回复且不重发", () => {
  const f = fixture();
  try {
    const { run } = f.store.create("test-project", "request-0001", "你好");
    assert.equal(f.store.claim(run.id, "owner", 1000), true);
    assert.equal(f.store.claim(run.id, "other", 1000), false);
    assert.equal(f.store.append(run.id, "other", "错误", 1001), false);
    assert.equal(f.store.append(run.id, "owner", "部分回复", 1001), true);
    assert.equal(f.store.renew(run.id, "owner", 1001 + LEASE_MS), false);
    assert.equal(f.store.append(run.id, "owner", "过期", 1001 + LEASE_MS), false);
    assert.equal(f.store.finish(run.id, "completed", null, "owner", null, 1001 + LEASE_MS), false);
    assert.equal(f.store.recover(1001 + LEASE_MS), 1);
    assert.equal(f.store.get(run.id).status, "interrupted");
    assert.equal(f.store.get(run.id).output, "部分回复");
    assert.equal(f.store.pending().length, 0);
  } finally { f.cleanup(); }
});

test("快照后增量重放无缺口，终态稳定，上下文只纳入完整对话", () => {
  const f = fixture();
  try {
    const { run } = f.store.create("test-project", "request-0001", "第一条");
    f.store.claim(run.id, "owner");
    const snapshot = f.store.get(run.id);
    for (let i = 0; i < 120; i++) assert.equal(f.store.append(run.id, "owner", "帧"), true);
    f.store.finish(run.id, "completed", null, "owner", { totalTokens: 130 });
    let cursor = snapshot.sequence;
    const replay: number[] = [];
    while (cursor < f.store.get(run.id).sequence) {
      const events = f.store.events(run.id, cursor);
      replay.push(...events.map((event) => event.sequence));
      cursor = events.at(-1)!.sequence;
    }
    assert.deepEqual(replay, Array.from({ length: 121 }, (_, i) => snapshot.sequence + i + 1));
    assert.equal(f.store.finish(run.id, "stopped"), false);
    const second = f.store.create("test-project", "request-0002", "第二条");
    const input = JSON.parse(f.store.row(second.run.id)!.input_json);
    assert.deepEqual(input.map((item: { role: string }) => item.role), ["user", "assistant", "user"]);
    f.store.finish(second.run.id, "stopped");
    const third = f.store.create("test-project", "request-0003", "第三条");
    assert.equal(JSON.parse(f.store.row(third.run.id)!.input_json).length, 3);
  } finally { f.cleanup(); }
});

test("两个真实进程同时提交同一请求只产生一条运行", async () => {
  const f = fixture();
  try {
    const ids = await Promise.all([worker(f.file, "create"), worker(f.file, "create")]);
    assert.equal(ids[0], ids[1]);
    assert.equal(f.store.history("test-project").length, 2);
  } finally { f.cleanup(); }
});

test("调用进程停止读取后独立工作进程仍持久完成", async () => {
  const f = fixture();
  try {
    const { run } = f.store.create("test-project", "request-0001", "断线测试");
    await worker(f.file, run.id);
    assert.equal(f.store.get(run.id).status, "completed");
    assert.equal(f.store.get(run.id).output.length, 80);
  } finally { f.cleanup(); }
});

test("独立工作进程收到停止后保留文本，迟到完成不能覆盖停止", async () => {
  const f = fixture();
  try {
    const { run } = f.store.create("test-project", "request-0001", "停止测试");
    const running = worker(f.file, run.id);
    const deadline = Date.now() + 5000;
    while (!f.store.get(run.id).output && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(f.store.get(run.id).output);
    f.store.finish(run.id, "stopped");
    const partial = f.store.get(run.id).output;
    await running;
    assert.equal(f.store.get(run.id).status, "stopped");
    assert.equal(f.store.get(run.id).output, partial);
  } finally { f.cleanup(); }
});

test("正式 TS 工作进程能独立启动，缺少密钥时持久失败且不发出供应商请求", async () => {
  const f = fixture();
  try {
    const { run } = f.store.create("test-project", "request-0001", "配置测试");
    await worker(f.file, run.id, true);
    assert.equal(f.store.get(run.id).status, "failed");
    assert.equal(f.store.get(run.id).errorCode, "CONFIG_MISSING");
    assert.equal(f.store.get(run.id).output, "");
  } finally { f.cleanup(); }
});
