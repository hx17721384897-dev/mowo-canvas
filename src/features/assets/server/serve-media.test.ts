import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveMedia } from "./serve-media.ts";

const root = await mkdtemp(join(tmpdir(), "mowo-media-cancel-"));
try {
  const path = join(root, "sample.mp4");
  await writeFile(path, Buffer.alloc(4 * 1024 * 1024, 7));
  const full = await serveMedia(new Request("http://localhost/sample.mp4"), { path, name: "sample.mp4", mimeType: "video/mp4" });
  assert.equal(full.status, 200);
  assert.equal((await full.arrayBuffer()).byteLength, 4 * 1024 * 1024);
  const range = await serveMedia(new Request("http://localhost/sample.mp4", { headers: { Range: "bytes=10-19" } }),
    { path, name: "sample.mp4", mimeType: "video/mp4" });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("Content-Range"), `bytes 10-19/${4 * 1024 * 1024}`);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  const head = await serveMedia(new Request("http://localhost/sample.mp4"), { path, name: "sample.mp4", mimeType: "video/mp4" }, true);
  assert.equal(head.body, null);
  const controller = new AbortController();
  const request = new Request("http://localhost/sample.mp4", { signal: controller.signal });
  const response = await serveMedia(request, { path, name: "sample.mp4", mimeType: "video/mp4" });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  controller.abort();
  await assert.doesNotReject(async () => {
    while (!(await reader.read()).done) { /* drain buffered bytes after cancellation */ }
  }, "aborting a preview request must close the response stream without an uncaught error");
} finally {
  await rm(root, { recursive: true, force: true });
}
