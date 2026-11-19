import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { runVideoFrames } from "../../src/features/frame-extraction/server/video-frame-runtime.ts";

const source = process.argv[2];
if (!source) throw new Error("Usage: node --experimental-strip-types scripts/video/verify-frame-sequence.ts <source video>");
const root = await mkdtemp(resolve("data/video-runtime/frame-real-"));
const exec = promisify(execFile);
const runtime = JSON.parse(await readFile("scripts/video/python-runtime.json", "utf8")) as { directory: string };
try {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  const indexPath = join(root, "index.sqlite");
  await exec(resolve("data/video-runtime", runtime.directory, "python.exe"), ["-I", resolve("scripts/video/frame_index.py"),
    "--ffprobe", resolve("data/video-runtime/tools/ffprobe.exe"), "--source", resolve(source), "--target", indexPath,
    "--content-hash", hash.digest("hex")], { windowsHide: true, timeout: 120000 });
  const database = new Database(indexPath, { readonly: true });
  const count = (database.prepare("SELECT COUNT(*) AS n FROM frames").get() as { n: number }).n;
  database.close();
  const startFrame = count > 180 ? 60 : 0, endFrame = Math.min(count, startFrame + 120);
  for (const restore of [false, true]) {
    const began = performance.now();
    const output = await runVideoFrames({ sourcePath: resolve(source), indexPath, startFrame, endFrame },
      { restore, ...(restore ? { targetFps: 30 } : {}), every: 2, keep: 1 },
      { tempRoot: root, extract: true, signal: new AbortController().signal });
    try {
      const { result } = output;
      assert.equal(result.issue, null);
      assert.ok(result.frames.length > 0 && result.frames.length <= 150);
      assert.ok(Math.abs(result.frames.reduce((sum, frame) => sum + frame.durationMs, 0) - result.durationMs) < 1e-6);
      assert.equal(result.frames[0].sourcePosition, startFrame);
      console.log(JSON.stringify({ restore, sourceFrames: endFrame - startFrame, outputFrames: result.frames.length,
        width: result.width, height: result.height, durationMs: result.durationMs, preparedBytes: result.preparedBytes,
        holds: result.holds.length, recommendation: result.recommendation, seconds: (performance.now() - began) / 1000 }));
    } finally { await output.dispose(); }
  }
} finally { await rm(root, { recursive: true, force: true }); }
