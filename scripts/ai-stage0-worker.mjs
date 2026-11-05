import Database from "better-sqlite3";
import { streamText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";

// Stage-0 harness only: its database is created by verify-ai-stage0.mjs.
const database = new Database(process.argv[2]);
const runId = process.argv[3];
const live = process.argv.includes("--live");
database.pragma("busy_timeout = 5000");
const append = database.prepare("UPDATE runs SET content = content || ?, sequence = sequence + 1 WHERE id = ? AND status = 'running'");
const finish = database.prepare("UPDATE runs SET status = ? WHERE id = ? AND status = 'running'");
const state = database.prepare("SELECT status FROM runs WHERE id = ?");
const controller = new AbortController();
const timer = setInterval(() => {
  if (state.get(runId)?.status === "stopped") controller.abort();
}, 25);
const timeout = setTimeout(() => controller.abort(), 60_000);

async function* mockStream() {
  for (let index = 0; index < 20; index++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (controller.signal.aborted) return;
    yield "测试";
  }
}

try {
  let output;
  if (live) {
    const provider = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
    output = streamText({
      model: provider("deepseek-flash"),
      prompt: "请用中文写一段约一百字的关于春天的描述。",
      providerOptions: { deepseek: { thinking: { type: "disabled" } } },
      maxOutputTokens: 200,
      maxRetries: 0,
      abortSignal: controller.signal,
      onError: () => {},
    });
  }
  for await (const text of output?.textStream ?? mockStream()) {
    if (controller.signal.aborted) break;
    append.run(text, runId);
  }
  if (output) {
    const reason = await output.finishReason;
    if (!["stop", "length"].includes(reason) && state.get(runId)?.status === "running") {
      throw new Error("Incomplete model stream");
    }
  }
  finish.run(controller.signal.aborted ? "interrupted" : "completed", runId);
} catch {
  // Never print SDK errors: they may contain request headers or message content.
  finish.run(controller.signal.aborted ? "interrupted" : "failed", runId);
} finally {
  clearInterval(timer);
  clearTimeout(timeout);
  database.close();
}
