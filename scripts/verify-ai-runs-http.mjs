import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { RunStore, LEASE_MS } from "../src/features/ai/server/run-store.ts";

// Requires npm run build. No provider call: real HTTP routes + isolated DB + offline worker.
const root = mkdtempSync(join(tmpdir(), "mowo-ai-http-"));
mkdirSync(join(root, "database"));
const file = join(root, "database", "mowo.db"), store = new RunStore(file);
store.db.pragma("journal_mode = WAL");
migrate(drizzle(store.db), { migrationsFolder: join(process.cwd(), "drizzle") });
store.db.prepare("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('test-project','HTTP测试',0,0)").run();
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MOWO_DATA_ROOT: root, DEEPSEEK_API_KEY: "" },
});
let startupLog = "";
server.stdout.on("data", (chunk) => { startupLog = (startupLog + chunk).slice(-5000); });
server.stderr.on("data", (chunk) => { startupLog = (startupLog + chunk).slice(-5000); });
const children = [server];
const projectUrl = "/api/projects/test-project/ai/runs";
const get = (url, init) => fetch(base + url, init);
const post = (url, data) => get(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(data) });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function offlineWorker(id) {
  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "scripts/ai-run-test-worker.ts", file, id, "300"], { windowsHide: true, stdio: "ignore" });
  children.push(child);
  const done = once(child, "exit").then(([code]) => assert.equal(code, 0));
  const deadline = Date.now() + 10000;
  while (!store.get(id).output && Date.now() < deadline) await delay(25);
  assert.ok(store.get(id).output, "Worker produced first chunk");
  return { done };
}
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try { if ((await get(projectUrl)).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode !== null) throw new Error(`HTTP server startup failed: ${startupLog}`);
    await delay(250);
  }
  assert.equal((await get(projectUrl, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await post(projectUrl, { message: "配置测试", clientRequestId: "no-key-request" })).status, 503);
  assert.equal((await get("/api/ai/runs/missing")).status, 404);
  const { run } = store.create("test-project", "disconnect-request", "断线测试");
  const worker = await offlineWorker(run.id);
  const subscription = await get(`/api/ai/runs/${run.id}/events?after=0`);
  assert.equal(subscription.headers.get("content-type"), "text/event-stream");
  const reader = subscription.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /data:/);
  assert.equal(store.get(run.id).status, "running");
  await reader.cancel(); // Real HTTP subscription cancellation, independent child continues.
  await worker.done;
  const restored = (await (await get(`/api/ai/runs/${run.id}`)).json()).run;
  assert.equal(restored.status, "completed"); assert.equal(restored.output.length, 80);
  const repeated = await post(projectUrl, { message: "断线测试", clientRequestId: "disconnect-request" });
  assert.equal(repeated.status, 200); assert.equal((await repeated.json()).run.id, run.id);
  assert.equal((await post(projectUrl, { message: "不同内容", clientRequestId: "disconnect-request" })).status, 409);
  const events = await (await get(`/api/ai/runs/${run.id}/events?after=0`)).text();
  const ids = [...events.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.deepEqual(ids, Array.from({ length: restored.sequence }, (_, i) => i + 1));
  assert.equal((await (await get(projectUrl)).json()).messages.length, 2);
  assert.equal((await (await get(projectUrl + "?clientRequestId=disconnect-request")).json()).run.id, run.id);
  const second = store.create("test-project", "stop-request", "停止测试").run;
  const stoppingWorker = await offlineWorker(second.id);
  assert.equal((await (await post(`/api/ai/runs/${second.id}/stop`, {})).json()).run.status, "stopped");
  const partial = store.get(second.id).output;
  await stoppingWorker.done;
  assert.equal(store.get(second.id).output, partial);
  assert.equal((await (await post(`/api/ai/runs/${second.id}/stop`, {})).json()).run.status, "stopped");
  const third = store.create("test-project", "expired-request", "重启核对").run;
  store.claim(third.id, "lost-worker", Date.now() - LEASE_MS - 1);
  assert.equal((await (await get(`/api/ai/runs/${third.id}`)).json()).run.status, "interrupted");
  console.log("AI HTTP verified: subscription cancellation, replay, retry/conflict, stop, history, lease recovery, local-origin and missing-key errors. No provider requests.");
} finally {
  for (const child of children) {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
  store.close();
  rmSync(root, { recursive: true, force: true });
}
