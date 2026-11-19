import assert from "node:assert/strict";
import test from "node:test";
import { checkVideoLocalRequest, readVideoJson, videoTaskResponse } from "./http.ts";

test("local origin checks run before task operations", async () => {
  const local = new Request("http://localhost:3000/api", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } });
  checkVideoLocalRequest(local);
  let called = false;
  const response = await videoTaskResponse(new Request("http://localhost:3000/api", { headers: { origin: "https://evil.test" } }), async () => { called = true; return {}; });
  assert.equal(response.status, 403); assert.equal(called, false);
  assert.throws(() => checkVideoLocalRequest(new Request("http://evil.test/api")));
});

test("bounded JSON handles UTF-8 chunk boundaries and rejects oversized or malformed bodies", async () => {
  const data = new TextEncoder().encode('{"title":"中文"}');
  const body = new ReadableStream({ start(controller) { controller.enqueue(data.slice(0, 11)); controller.enqueue(data.slice(11)); controller.close(); } });
  const request = new Request("http://localhost/api", { method: "POST", body, duplex: "half" } as RequestInit);
  assert.deepEqual(await readVideoJson(request), { title: "中文" });
  await assert.rejects(readVideoJson(new Request("http://localhost/api", { method: "POST", body: "x" })), { code: "INVALID_JSON" });
  await assert.rejects(readVideoJson(new Request("http://localhost/api", { method: "POST", body: "x".repeat(17000) })), { code: "BODY_TOO_LARGE" });
});

test("unexpected errors never expose paths, signed URLs or credentials", async () => {
  const response = await videoTaskResponse(new Request("http://localhost/api"), async () => { throw new Error("SECRET C:/private https://cdn.test/?token=secret"); });
  assert.equal(response.status, 500); assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json(); assert.equal(data.code, "INTERNAL_ERROR"); assert.ok(!JSON.stringify(data).includes("SECRET"));
});
