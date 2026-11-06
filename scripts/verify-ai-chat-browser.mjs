import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { RunStore } from "../src/features/ai/server/run-store.ts";

// Uses installed Chromium via its debugging protocol; no new dependencies.
// Default is offline. --live makes exactly one short, user-triggered model request.
const live = process.argv.includes("--live");
if (live && !process.env.DEEPSEEK_API_KEY) throw new Error("Live check requires a configured server key");
const root = mkdtempSync(join(tmpdir(), "mowo-ai-browser-"));
mkdirSync(join(root, "database"));
const store = new RunStore(join(root, "database", "mowo.db"));
store.db.pragma("journal_mode = WAL");
migrate(drizzle(store.db), { migrationsFolder: join(process.cwd(), "drizzle") });
store.db.prepare("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('test-project','对话功能验收',0,0)").run();
store.db.prepare("INSERT INTO canvas_documents (project_id,schema_version,nodes_json,edges_json,viewport_json,created_at,updated_at) VALUES ('test-project',1,'[]','[]',?,0,0)").run(JSON.stringify({ x: 0, y: 0, zoom: 1 }));
const processes = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket, heartbeat, sessionId;
const pending = new Map();
let nextId = 0;
function cdp(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("Browser evaluation failed");
  return result.result.value;
}
async function waitFor(expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Reload briefly destroys the execution context and removes document.body.
    try { if (await evaluate(expression)) return; } catch {}
    await delay(100);
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}
try {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, MOWO_DATA_ROOT: root, DEEPSEEK_API_KEY: live ? process.env.DEEPSEEK_API_KEY : "" },
  });
  processes.push(server);
  const deadline = Date.now() + 25000;
  while (true) {
    try { if ((await fetch(base + "/api/ai/status")).ok) break; } catch {}
    if (Date.now() > deadline || server.exitCode !== null) throw new Error("Test server did not start; build first");
    await delay(200);
  }
  let offlineRun;
  if (!live) {
    store.db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('other-project','其他画布',0,0)").run();
    const other = store.createConversation("other-project");
    store.renameConversation("other-project", other.id, "其他画布会话");
    offlineRun = store.create("test-project", "browser-offline-request", "请帮我整理一个动画创作思路。").run;
    store.claim(offlineRun.id, "browser-fixture");
    store.append(offlineRun.id, "browser-fixture", "可以先确定角色、场景与动作，再整理为有顺序的动画帧。");
    heartbeat = setInterval(() => store.renew(offlineRun.id, "browser-fixture"), 1000);
  }
  const cache = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ms-playwright");
  const revision = readdirSync(cache).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort().at(-1);
  const executable = process.env.MOWO_TEST_CHROMIUM ?? join(cache, revision, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  const browser = spawn(executable, ["--headless", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${join(root, "browser")}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  processes.push(browser);
  let browserLog = "";
  browser.stderr.on("data", (chunk) => { browserLog = (browserLog + chunk).slice(-3000); });
  let activePort;
  for (let i = 0; i < 100; i++) {
    try { activePort = readFileSync(join(root, "browser", "DevToolsActivePort"), "utf8").trim().split(/\r?\n/); break; } catch {}
    await delay(100);
  }
  assert.ok(activePort, `Installed Chromium debugging port available: ${browserLog}`);
  socket = new WebSocket(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
  await once(socket, "open");
  const browserErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.text);
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true }));
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: base + "/canvas/test-project" });
  await waitFor(`!!document.querySelector('textarea[aria-label="输入消息"]') && !document.body.innerText.includes('正在恢复对话')`);
  if (live) {
    await waitFor(`[...document.querySelectorAll('button')].some(b=>b.type==='submit' && !b.disabled)` , 3000).catch(() => {});
    await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="输入消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'请只回复：连接成功');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor(`[...document.querySelectorAll('button')].some(b=>b.type==='submit' && !b.disabled)`);
    await evaluate(`document.querySelector('textarea[aria-label="输入消息"]').closest('form').requestSubmit()`);
    const completedBy = Date.now() + 45000;
    while (true) {
      const rows = store.db.prepare("SELECT id,status,error_code FROM ai_runs").all();
      assert.ok(rows.length <= 1, "One UI action must create at most one run");
      if (rows[0]?.status === "completed") break;
      if (rows[0] && ["failed", "interrupted"].includes(rows[0].status)) throw new Error(`Live run failed: ${rows[0].error_code}`);
      if (Date.now() > completedBy) throw new Error("Live run did not complete; no retry issued");
      await delay(250);
    }
    await waitFor(`document.body.innerText.includes('连接成功')`);
  } else {
    await waitFor(`document.body.innerText.includes('可以先确定角色')`);
    store.append(offlineRun.id, "browser-fixture", "每一步都可以在画布上保存和整理。");
    await waitFor(`document.body.innerText.includes('每一步都可以在画布上保存和整理')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='停止').click()`);
    await waitFor(`document.body.innerText.includes('已停止')`);
    assert.equal(store.get(offlineRun.id).status, "stopped");
  }
  await evaluate(`document.querySelector('[aria-label="折叠右侧对话栏"]').click()`);
  await waitFor(`!!document.querySelector('aside[inert]')`);
  await evaluate(`document.querySelector('[aria-label="展开右侧对话栏"]').click()`);
  await waitFor(`!document.querySelector('aside[inert]')`);
  await cdp("Page.reload");
  await waitFor(live ? `document.body.innerText.includes('连接成功')` : `document.body.innerText.includes('已停止') && document.body.innerText.includes('每一步都可以在画布上保存和整理')`);
  // A canvas viewport draft belongs to the existing editor recovery flow, not chat.
  await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='保留已保存版本')?.click()`);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM ai_runs").get().n, 1);
  await evaluate(`document.querySelector('[aria-label="会话设置菜单"]').click()`);
  await evaluate(`document.querySelector('[aria-label="语言模型设置"]').click()`);
  await waitFor(`!!document.querySelector('dialog[aria-labelledby="language-model-title"][open]')`);
  await evaluate(`[...document.querySelector('dialog[aria-labelledby="language-model-title"][open]').querySelectorAll('button')].find(b=>b.textContent==='关闭').click()`);
  await waitFor(`!document.querySelector('dialog[aria-labelledby="language-model-title"][open]')`);
  if (!live) {
    const initialWidth = await evaluate(`document.querySelector('textarea[aria-label="输入消息"]').closest('aside').getBoundingClientRect().width`);
    await evaluate(`document.querySelector('[aria-label="放大对话区"]').click()`);
    await delay(300);
    assert.ok(await evaluate(`document.querySelector('textarea[aria-label="输入消息"]').closest('aside').getBoundingClientRect().width`) > initialWidth + 100);
    await evaluate(`document.querySelector('[aria-label="还原对话区"]').click()`); await delay(300);
    assert.ok(Math.abs(await evaluate(`document.querySelector('textarea[aria-label="输入消息"]').closest('aside').getBoundingClientRect().width`) - initialWidth) < 2);
    const alignment = await evaluate(`(()=>{const times=[...document.querySelectorAll('time')];return times.slice(0,2).map(t=>{const r=t.parentElement.parentElement.firstElementChild.getBoundingClientRect();return {left:r.left,right:r.right}})})()`);
    assert.ok(alignment[0].left > alignment[1].left + 10, "Questions align to the right, answers to the left");
    if (await evaluate(`matchMedia('(hover: hover)').matches`)) {
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 }); await delay(180);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('time').parentElement).opacity`), "0");
      const rect = await evaluate(`(()=>{const r=document.querySelector('time').parentElement.parentElement.firstElementChild.getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()`);
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect }); await delay(180);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('time').parentElement).opacity`), "1");
    }
    await evaluate(`document.querySelector('[aria-label="修改会话名称"]').click()`);
    await evaluate(`(()=>{const i=document.querySelector('[aria-label="会话名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'动画讨论');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('[aria-label="会话名称"]').blur()`);
    await waitFor(`document.querySelector('[aria-label="修改会话名称"]')?.textContent==='动画讨论'`);
    await evaluate(`document.querySelector('[aria-label="历史会话"]').click()`);
    await waitFor(`!!document.querySelector('[aria-label="搜索历史会话"]')`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="当前画布的历史会话"]').textContent.includes('其他画布会话')`), false);
    await evaluate(`document.querySelector('[aria-label="重命名 动画讨论"]').click()`);
    await evaluate(`(()=>{const i=document.querySelector('[aria-label="历史会话名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'动画讨论二');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('[aria-label="历史会话名称"]').blur()`);
    await waitFor(`document.querySelector('[aria-label="修改会话名称"]')?.textContent==='动画讨论二'`);
    await evaluate(`(()=>{const i=document.querySelector('[aria-label="搜索历史会话"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'没有这个名字');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor(`document.body.innerText.includes('没有匹配的会话')`);
    await evaluate(`document.querySelector('[aria-label="新建会话"]').click()`);
    await waitFor(`document.querySelector('[aria-label="修改会话名称"]')?.textContent==='新会话' && !document.body.innerText.includes('每一步都可以在画布上保存和整理')`);
    await evaluate(`document.querySelector('[aria-label="新建会话"]').click()`); await delay(300);
    assert.equal(store.conversations("test-project").length, 2, "Repeated blank creation does not duplicate drafts");
    await evaluate(`document.querySelector('[aria-label="历史会话"]').click()`);
    await evaluate(`[...document.querySelector('[aria-label="当前画布的历史会话"]').querySelectorAll('button')].find(b=>b.textContent.includes('动画讨论二')).click()`);
    await waitFor(`document.body.innerText.includes('每一步都可以在画布上保存和整理')`);
    await cdp("Page.reload");
    await waitFor(`document.querySelector('[aria-label="修改会话名称"]')?.textContent==='动画讨论二'`);
    await waitFor(`document.body.innerText.includes('每一步都可以在画布上保存和整理') && !document.body.innerText.includes('正在恢复对话')`);
    await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='保留已保存版本')?.click()`);
  }
  const overflow = await evaluate(`(()=>{const panel=document.querySelector('textarea[aria-label="输入消息"]').closest('aside');return panel.scrollWidth>panel.clientWidth+1})()`);
  assert.equal(overflow, false, "Sidebar fits its available width");
  assert.deepEqual(browserErrors, [], "No uncaught browser exceptions");
  const screenshot = process.env.MOWO_TEST_SCREENSHOT ?? join(tmpdir(), "mowo-ai-chat-v1.png");
  writeFileSync(screenshot, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  console.log(`AI chat browser verified (${live ? "one live request" : "offline stream/stop, per-canvas conversations, rename/search/switch, layout and hover controls"}): restored history, collapse/expand, settings dialog, no duplicate runs or browser exceptions. Screenshot: ${screenshot}`);
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN && sessionId) {
    try {
      console.error("Isolated browser diagnostic:", await evaluate(`({alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),body:document.body.innerText.slice(-1500)})`));
      writeFileSync(join(tmpdir(), "mowo-ai-chat-failure.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
    } catch {}
  }
  console.error("Isolated run states:", store.db.prepare("SELECT status,error_code FROM ai_runs").all());
  throw error;
} finally {
  clearInterval(heartbeat);
  socket?.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  for (const child of processes.reverse()) {
    if (child.exitCode === null) { const done = once(child, "exit"); child.kill(); await done; }
  }
  // A live worker may outlive the browser on failure; stop before releasing the fixture.
  for (const row of store.pending()) store.finish(row.id, "stopped");
  const active = store.db.prepare("SELECT id FROM ai_runs WHERE status='running'").all();
  for (const row of active) store.finish(row.id, "stopped");
  if (active.length) await delay(1000);
  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
