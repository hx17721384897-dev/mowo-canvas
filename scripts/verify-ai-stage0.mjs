import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";

const live = process.argv.includes("--live");
if (live && !process.env.DEEPSEEK_API_KEY?.trim()) {
  console.error("请先在本机配置 DEEPSEEK_API_KEY。");
  process.exit(1);
}
const directory = await mkdtemp(join(tmpdir(), "mowo-ai-stage0-"));
const dbPath = join(directory, "runs.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE, status TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', sequence INTEGER NOT NULL DEFAULT 0)");
const create = db.prepare("INSERT INTO runs(id, request_id, status) VALUES (?, ?, 'running') ON CONFLICT(request_id) DO NOTHING");
const get = db.prepare("SELECT * FROM runs WHERE id = ?");
const stop = db.prepare("UPDATE runs SET status = 'stopped' WHERE id = ? AND status = 'running'");
const children = new Set();

async function runScenario(id, shouldStop) {
  create.run(id, id);
  assert.equal(create.run("duplicate", id).changes, 0);
  const child = spawn(process.execPath, [
    resolve("scripts/ai-stage0-worker.mjs"), dbPath, id, ...(live ? ["--live"] : []),
  ], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
  children.add(child);
  const exited = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      children.delete(child);
      if (code === 0) resolveExit(); else reject(new Error("测试执行器异常退出"));
    });
  });
  try {
    const deadline = Date.now() + 65_000;
    let partial;
    while (Date.now() < deadline) {
      partial = get.get(id);
      if (partial.sequence > 0 || partial.status !== "running") break;
      await delay(20);
    }
    assert.ok(partial.sequence > 0, "未收到流式文本，检查模型、网络或参数");
    if (shouldStop) {
      assert.equal(stop.run(id).changes, 1, "停止前模型已结束，需重新设计测试");
      stop.run(id); // A second stop must be harmless.
    } else {
      // Simulate a browser that stops subscribing. The worker has no subscriber dependency.
      await delay(200);
    }
    await exited;
    const final = get.get(id);
    assert.equal(final.status, shouldStop ? "stopped" : "completed");
    assert.ok(final.content.length >= partial.content.length);
    if (!shouldStop) {
      assert.equal(stop.run(id).changes, 0, "完成后的迟到停止不得覆盖终态");
      assert.ok(final.sequence > 1, "需要收到多个文本增量");
    }
    console.log(`${live ? "真实 API" : "模拟"} ${id} 通过，持久事件数 ${final.sequence}`);
  } finally {
    if (children.has(child)) {
      child.kill();
      await exited.catch(() => {});
    }
  }
}

try {
  await runScenario("disconnect-and-recover", false);
  await runScenario("stop-and-preserve", true);
  console.log("独立子进程、请求去重、持久输出、停止及终态保护验证通过。");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill();
  db.close();
  await rm(directory, { recursive: true, force: true });
}
