// Offline integration fixture. Production never imports this file.
import { RunStore } from "../src/features/ai/server/run-store.ts";
const store = new RunStore(process.argv[2]);
try {
  if (process.argv[3] === "create") {
    console.log(store.create("test-project", "parallel-request", "并发消息").run.id);
  } else {
    const id = process.argv[3];
    if (store.claim(id, "test-worker")) {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, Number(process.argv[4] ?? 50)));
        if (!store.append(id, "test-worker", "离线测试")) break;
      }
      store.finish(id, "completed", null, "test-worker");
    }
  }
} finally { store.close(); }
