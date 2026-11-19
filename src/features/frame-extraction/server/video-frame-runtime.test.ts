import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { runVideoFrames } from "./video-frame-runtime.ts";

const exec = promisify(execFile);

test("real worker protocol: extract PNG, keep PTS, cancel, and clean failures", async () => {
  const root = await mkdtemp(resolve("data/video-runtime/frame-runtime-test-"));
  const runtime = JSON.parse(await readFile("scripts/video/python-runtime.json", "utf8")) as { directory: string };
  const python = resolve("data/video-runtime", runtime.directory, "python.exe");
  const source = join(root, "source.mp4"), indexPath = join(root, "index.sqlite");
  try {
    await exec(resolve("data/video-runtime/tools/ffmpeg.exe"), ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=60:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { windowsHide: true });
    await exec(python, ["-I", resolve("scripts/video/frame_index.py"), "--ffprobe", resolve("data/video-runtime/tools/ffprobe.exe"),
      "--source", source, "--target", indexPath, "--content-hash", createHash("sha256").update(await readFile(source)).digest("hex")], { windowsHide: true });
    const input = { sourcePath: source, indexPath, startFrame: 0, endFrame: 180 };
    const options = { tempRoot: root, extract: true, signal: new AbortController().signal };
    const output = await runVideoFrames(input, { restore: false, every: 3, keep: 1 }, options);
    assert.equal(output.result.frames.length, 60);
    assert.equal(output.result.frames[1].sourcePosition, 3);
    const image = await readFile(join(output.directory, output.result.frames[0].file!));
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await output.dispose();
    const before = (await readdir(root)).sort();
    await assert.rejects(runVideoFrames(input, { restore: false, every: 1, keep: 1 }, options), { code: "OUTPUT_LIMIT" });
    assert.deepEqual((await readdir(root)).sort(), before);
    const controller = new AbortController();
    await assert.rejects(runVideoFrames(input, { restore: false, every: 3, keep: 1 }, {
      ...options, signal: controller.signal, onProgress: () => controller.abort(),
    }), { code: "CANCELLED" });
    assert.deepEqual((await readdir(root)).sort(), before);
    await assert.rejects(runVideoFrames(input, { restore: false, every: 1, keep: 2 }, options));
    assert.deepEqual((await readdir(root)).sort(), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
