import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { RunStore } from "../src/features/ai/server/run-store.ts";
import type { ChatMessage } from "../src/features/ai/types.ts";

// One independently owned request per process. Never log provider errors or keys.
const store = new RunStore(process.argv[2]);
const runId = process.argv[3], token = randomUUID();
if (!store.claim(runId, token)) { store.close(); process.exit(0); }
const abort = new AbortController();
let timedOut = false;
const heartbeat = setInterval(() => {
  try { if (!store.renew(runId, token)) abort.abort(); }
  catch { abort.abort(); }
}, 250);
const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 120_000);
function errorCode(error: unknown) {
  if (error instanceof Error && error.message === "CONFIG_MISSING") return "CONFIG_MISSING";
  const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
  return status === 401 ? "PROVIDER_AUTH" : status === 402 ? "PROVIDER_BALANCE"
    : status === 429 ? "PROVIDER_LIMIT" : status === 400 || status === 422 ? "PROVIDER_INPUT" : "PROVIDER_ERROR";
}
try {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error("CONFIG_MISSING");
  const row = store.row(runId)!;
  const result = streamText({
    model: createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })(row.model),
    messages: JSON.parse(row.input_json) as ChatMessage[],
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
    maxOutputTokens: 2048, maxRetries: 0, abortSignal: abort.signal,
    onError: () => {},
  });
  // fullStream preserves typed errors; an ended transport is not proof of success.
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta" && !store.append(runId, token, part.text)) { abort.abort(); break; }
  }
  const reason = await result.finishReason;
  if (abort.signal.aborted || !["stop", "length"].includes(reason)) throw new Error("INCOMPLETE_STREAM");
  const usage = await result.totalUsage;
  store.finish(runId, "completed", null, token, {
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
  });
} catch (error) {
  store.finish(runId, timedOut ? "interrupted" : "failed", timedOut ? "RUN_TIMEOUT" : errorCode(error), token);
} finally {
  clearInterval(heartbeat); clearTimeout(timeout); store.close();
}
