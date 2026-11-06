import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLocalRequest } from "./request-policy.ts";

test("Next 内部地址与浏览器访问地址不同时允许真实同源请求", () => {
  assert.doesNotThrow(() => checkLocalRequest(new Request("http://localhost:3000/api/ai/status", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
  })));
  assert.doesNotThrow(() => checkLocalRequest(new Request("http://localhost:3000/api/ai/status", {
    headers: { host: "[::1]:3000", origin: "http://[::1]:3000" },
  })));
});
test("拒绝外部地址、跨站、不同端口和伪造的转发地址", () => {
  const cases: Record<string, string>[] = [
    { host: "untrusted.example", origin: "http://untrusted.example" },
    { host: "localhost:3000", origin: "http://localhost:3001" },
    { host: "localhost:3000", origin: "http://127.0.0.1:3000" },
    { host: "localhost:3000", "sec-fetch-site": "cross-site" },
    { host: "untrusted.example", "x-forwarded-host": "localhost:3000" },
    { host: "untrusted@localhost:3000" },
  ];
  for (const headers of cases) assert.throws(() => checkLocalRequest(new Request("http://localhost:3000/api/ai/status", { headers })), /LOCAL_ONLY/);
});
