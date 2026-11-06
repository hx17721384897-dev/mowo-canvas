import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("同画布多会话隔离上下文，列表/重命名/发送均拒绝跨画布会话", () => {
  const f = fixture();
  try {
    const first = f.store.createConversation("test-project");
    assert.equal(f.store.createConversation("test-project").id, first.id, "连续新建空会话只复用一条");
    const a = f.store.create("test-project", "first-request", "我的第一条提问", first.id).run;
    f.store.claim(a.id, "owner"); f.store.append(a.id, "owner", "第一组回答"); f.store.finish(a.id, "completed", null, "owner");
    assert.equal(f.store.conversations("test-project")[0].title, "我的第一条提问");
    const second = f.store.createConversation("test-project");
    f.store.renameConversation("test-project", second.id, "手动命名");
    const b = f.store.create("test-project", "second-request", "新的提问", second.id).run;
    assert.equal(JSON.parse(f.store.row(b.id)!.input_json).length, 1, "新会话不发送其他会话的上下文");
    assert.equal(f.store.history("test-project", first.id).length, 2);
    assert.equal(f.store.conversations("test-project", "手动")[0].id, second.id);
    assert.equal(f.store.conversations("test-project").find((row) => row.id === second.id)?.title, "手动命名");
    f.store.db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('other','另一画布',0,0)").run();
    assert.equal(f.store.conversations("other").length, 0);
    assert.throws(() => f.store.history("other", first.id), code("CONVERSATION_NOT_FOUND"));
    assert.throws(() => f.store.renameConversation("other", first.id, "错误"), code("CONVERSATION_NOT_FOUND"));
    assert.throws(() => f.store.create("other", "other-request", "错误", first.id), code("CONVERSATION_NOT_FOUND"));
    assert.throws(() => f.store.create("test-project", "first-request", "我的第一条提问", second.id), code("REQUEST_CONFLICT"));
  } finally { f.cleanup(); }
});

test("升级前的聊天记录、事件、请求标识完整迁入历史会话", () => {
  const root = mkdtempSync(join(tmpdir(), "mowo-ai-upgrade-")), migrations = join(root, "migrations");
  mkdirSync(join(migrations, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 5);
  for (const entry of journal.entries) copyFileSync(join("drizzle", `${entry.tag}.sql`), join(migrations, `${entry.tag}.sql`));
  writeFileSync(join(migrations, "meta", "_journal.json"), JSON.stringify(journal));
  const store = new RunStore(join(root, "old.db"));
  try {
    migrate(drizzle(store.db), { migrationsFolder: migrations });
    store.db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','老画布',0,0)").run();
    const hash = createHash("sha256").update(JSON.stringify({ message: "旧问题", model: "deepseek-flash" })).digest("hex");
    store.db.prepare(`INSERT INTO ai_runs(id,project_id,client_request_id,input_hash,model,input_json,status,output,sequence,created_at,updated_at)
      VALUES('old-run','old-project','old-request',?,'deepseek-flash',?,'completed','旧回答',1,1,2)`).run(hash, JSON.stringify([{ role: "user", content: "旧问题" }]));
    store.db.prepare("INSERT INTO ai_messages(id,run_id,role,content,status,created_at) VALUES('old-u','old-run','user','旧问题','submitted',1),('old-a','old-run','assistant','旧回答','completed',2)").run();
    store.db.prepare("INSERT INTO ai_events(run_id,sequence,payload_json) VALUES('old-run',1,'{}')").run();
    migrate(drizzle(store.db), { migrationsFolder: join(process.cwd(), "drizzle") });
    const rows = store.conversations("old-project");
    assert.equal(rows.length, 1); assert.equal(rows[0].title, "旧问题");
    assert.equal(store.history("old-project", rows[0].id)[1].content, "旧回答");
    assert.equal(store.events("old-run", 0).length, 1);
    assert.equal(store.create("old-project", "old-request", "旧问题", rows[0].id).run.id, "old-run");
    assert.equal((store.db.prepare("SELECT count(*) AS n FROM ai_runs").get() as { n: number }).n, 1);
    store.db.prepare("DELETE FROM projects WHERE id='old-project'").run();
    assert.equal(store.db.prepare("SELECT id FROM ai_runs").all().length, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
