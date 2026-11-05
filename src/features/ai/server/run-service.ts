import "server-only";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getAssetDatabase } from "@/features/assets/server/database";
import { getAssetDataPaths } from "@/features/assets/server/data-paths";
import { RunError, RunStore } from "./run-store";

// The shared migration runner upgrades the existing database before workers open it.
export async function withRuns<T>(action: (store: RunStore) => T): Promise<T> {
  await getAssetDatabase();
  const store = new RunStore(getAssetDataPaths().database);
  try { store.recover(); return action(store); }
  finally { store.close(); }
}

export async function dispatchPending() {
  const pending = await withRuns((store) => store.pending());
  for (const { id } of pending) {
    // Multiple dispatchers may race: the worker's atomic claim allows only one caller.
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types",
      join(process.cwd(), "scripts", "ai-run-worker.ts"), getAssetDataPaths().database, id], {
      cwd: process.cwd(), env: process.env, detached: true, windowsHide: true, stdio: "ignore",
    });
    const failedStart = () => { void withRuns((store) => store.failQueued(id)).catch(() => {}); };
    child.on("error", failedStart);
    // Syntax/import failures happen before the worker can claim its lease.
    child.on("exit", failedStart);
    child.unref();
  }
}

const messages: Record<string, string> = {
  INVALID_INPUT: "消息不能为空，最多 8000 字；请求标识格式无效。",
  REQUEST_CONFLICT: "此请求标识已用于另一条消息，请重新发送。",
  RUN_ACTIVE: "当前画布仍有回复正在生成，请等待或停止。",
  CAPACITY_LIMIT: "已有三个对话正在生成，请稍后再试。",
  PROJECT_NOT_FOUND: "画布不存在。", RUN_NOT_FOUND: "对话运行不存在。",
  CONFIG_MISSING: "请先在本机配置 DeepSeek API Key。",
  LOCAL_ONLY: "AI 接口当前仅供本机同源页面使用。",
  INVALID_CURSOR: "事件序号无效，请重新读取运行快照。",
};
export function aiError(error: unknown) {
  const known = error instanceof RunError;
  const code = known ? error.code : "INTERNAL_ERROR";
  return Response.json({ code, error: messages[code] ?? "对话服务暂时不可用，请稍后重试。" }, { status: known ? error.status : 500 });
}

export function checkLocalRequest(request: Request) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new RunError("LOCAL_ONLY", 403);
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new RunError("LOCAL_ONLY", 403);
}

export async function readRunInput(request: Request) {
  // Bound the actual streamed body, not just a caller-supplied Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new RunError("INVALID_INPUT");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 40_000) { await reader.cancel(); throw new RunError("INVALID_INPUT", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const input: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!input || typeof input !== "object" || !("message" in input) || !("clientRequestId" in input)
      || typeof input.message !== "string" || typeof input.clientRequestId !== "string"
      || Object.keys(input).some((key) => !["message", "clientRequestId"].includes(key))) throw new Error();
    return { message: input.message, clientRequestId: input.clientRequestId };
  } catch { throw new RunError("INVALID_INPUT"); }
}
