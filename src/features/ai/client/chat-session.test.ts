import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatRequestError, ChatSession } from "./chat-session.ts";
import type { AiRun, ConversationSnapshot } from "../types.ts";

const run: AiRun = { id: "run-1", projectId: "project-1", clientRequestId: "request-0001", model: "deepseek-flash", status: "running", output: "", sequence: 2, errorCode: null, usage: null, createdAt: 1, updatedAt: 1 };
const configuration = { configured: true, provider: "deepseek", model: "deepseek-flash" };
const conversation = (active: AiRun | null = run): ConversationSnapshot => ({
  messages: [{ id: "user-1", runId: run.id, role: "user", content: "测试消息", status: "submitted", errorCode: null, createdAt: 1 },
    { id: "assistant-1", runId: run.id, role: "assistant", content: active?.output ?? "已完成", status: active?.status ?? "completed", errorCode: null, createdAt: 1 }], activeRun: active,
});
async function ready(session: ChatSession) {
  for (let i = 0; i < 100 && session.getSnapshot().loading; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(session.getSnapshot().loading, false);
}
function fixture(handler: (path: string, init?: RequestInit) => Promise<unknown>, writeFailure = false, conversationId?: string) {
  let pending: { clientRequestId: string; message: string } | null = null;
  let ids = 0;
  const streams: Pick<EventSource, "close" | "onmessage" | "onerror">[] = [];
  const session = new ChatSession("project-1", {
    request: async <T>(path: string, init?: RequestInit) => (path === "/api/ai/status" ? configuration : await handler(path, init)) as T,
    uuid: () => `request-${String(++ids).padStart(4, "0")}`,
    readPending: () => pending,
    writePending: (value) => { if (writeFailure) throw new Error("No storage"); pending = value; },
    stream: () => { const stream = { close() {}, onmessage: null, onerror: null }; streams.push(stream); return stream; },
  }, conversationId);
  session.start();
  return { session, streams };
}

test("发送响应丢失先查原请求，已接收时不重复 POST", async () => {
  let posts = 0, accepted = false;
  const { session } = fixture(async (path, init) => {
    if (init?.method === "POST") { posts++; accepted = true; throw new Error("Response lost"); }
    if (path.includes("?clientRequestId=")) return { run };
    return accepted ? conversation() : { messages: [], activeRun: null };
  });
  try {
    await ready(session);
    assert.equal(await session.send("测试消息"), false);
    assert.ok(session.getSnapshot().pending);
    session.dispose(); session.start(); await ready(session);
    await session.resolvePending(true);
    assert.equal(posts, 1); assert.equal(session.getSnapshot().pending, null);
    assert.equal(session.getSnapshot().messages.length, 2);
  } finally { session.dispose(); }
});

test("确认未接收后重试沿用请求 ID，双击不会再创建一条消息", async () => {
  const ids: string[] = [];
  let accepted = false;
  const { session } = fixture(async (path, init) => {
    if (init?.method === "POST") {
      ids.push(JSON.parse(String(init.body)).clientRequestId);
      if (ids.length === 1) throw new Error("Not received");
      accepted = true; return { run };
    }
    if (path.includes("?clientRequestId=")) throw new ChatRequestError("RUN_NOT_FOUND", "未接收");
    return accepted ? conversation() : { messages: [], activeRun: null };
  });
  try {
    await ready(session);
    const first = session.send("测试消息"), second = session.send("测试消息");
    assert.equal(await second, false); await first;
    await session.resolvePending(true);
    assert.deepEqual(ids, ["request-0001", "request-0001"]);
    assert.equal(session.getSnapshot().messages.length, 2);
  } finally { session.dispose(); }
});

test("SSE 重复/缺口不重复追加，折叠后卸载只结束订阅", async () => {
  const { session, streams } = fixture(async () => conversation());
  try {
    await ready(session);
    const event = new MessageEvent("message", { data: JSON.stringify({ type: "delta", text: "你好" }), lastEventId: "3" });
    const stream = streams.at(-1)!;
    stream.onmessage?.call(stream as EventSource, event);
    stream.onmessage?.call(stream as EventSource, event);
    stream.onmessage?.call(stream as EventSource, new MessageEvent("message", { data: JSON.stringify({ type: "delta", text: "有缺口" }), lastEventId: "5" }));
    assert.equal(session.getSnapshot().messages[1].content, "你好");
    session.dispose();
    stream.onmessage?.call(stream as EventSource, new MessageEvent("message", { data: JSON.stringify({ type: "delta", text: "迟到" }), lastEventId: "4" }));
    assert.equal(session.getSnapshot().messages[1].content, "你好");
  } finally { session.dispose(); }
});

test("停止与完成竞态尊重服务端终态，不伪造停止", async () => {
  let stopped = false;
  const { session } = fixture(async (path) => {
    if (path.endsWith("/stop")) { stopped = true; return { run: { ...run, status: "completed", output: "已完成", sequence: 4 } }; }
    return stopped ? conversation(null) : conversation();
  });
  try {
    await ready(session); await session.stop();
    assert.equal(session.getSnapshot().activeRun, null);
    assert.equal(session.getSnapshot().messages[1].status, "completed");
  } finally { session.dispose(); }
});

test("无法持久保存请求 ID 时不发送；历史加载失败也不允许盲发", async () => {
  let posts = 0;
  const { session } = fixture(async (_path, init) => { if (init?.method) posts++; return { messages: [], activeRun: null }; }, true);
  try { await ready(session); assert.equal(await session.send("测试消息"), false); assert.equal(posts, 0); }
  finally { session.dispose(); }
  const failed = fixture(async () => { throw new Error("History unavailable"); });
  try { await ready(failed.session); assert.equal(await failed.session.send("测试消息"), false); }
  finally { failed.session.dispose(); }
});

test("提交成功但历史刷新失败时保留已知运行，禁止再次付费发送", async () => {
  let posts = 0;
  const { session } = fixture(async (_path, init) => {
    if (init?.method === "POST") { posts++; return { run }; }
    if (posts) throw new Error("History response lost");
    return { messages: [], activeRun: null };
  });
  try {
    await ready(session);
    assert.equal(await session.send("测试消息"), true);
    assert.equal(session.getSnapshot().activeRun?.id, run.id);
    assert.equal(await session.send("测试消息"), false);
    assert.equal(posts, 1);
  } finally { session.dispose(); }
});

test("切换会话后发送和丢失响应核对始终携带原会话 ID", async () => {
  const paths: string[] = [];
  let body: { conversationId?: string } = {};
  const { session } = fixture(async (path, init) => {
    paths.push(path);
    if (init?.method === "POST") { body = JSON.parse(String(init.body)); throw new Error("Response lost"); }
    if (path.includes("clientRequestId=")) return { run: { ...run, conversationId: "thread-A" } };
    return { messages: [], activeRun: null };
  }, false, "thread-A");
  try {
    await ready(session); await session.send("测试消息"); await session.resolvePending(true);
    assert.equal(body.conversationId, "thread-A");
    assert.ok(paths.some((path) => path.includes("?conversationId=thread-A&clientRequestId=request-0001")));
  } finally { session.dispose(); }
});
