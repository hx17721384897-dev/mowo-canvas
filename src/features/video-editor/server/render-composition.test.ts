import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compositionFilter, renderComposition } from "./render-composition.ts";

test("filter keeps source frame ranges in the requested composition order", () => {
  const script = compositionFilter([
    { inFrame: 8, outFrame: 12, startSeconds: 4, endSeconds: 6 },
    { inFrame: 0, outFrame: 4, startSeconds: 0, endSeconds: 2 },
  ], true);
  assert.ok(script.includes("trim=start_frame=8:end_frame=12"));
  assert.ok(script.includes("[vt0][at0][vt1][at1]concat=n=2:v=1:a=1"));
});

test("rendered MP4 has the exact ordered frame count and synchronized audio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mowo-composition-"));
  const ffmpeg = join(process.cwd(), "data", "video-runtime", "tools", "ffmpeg.exe");
  const source = join(directory, "source.mp4"), target = join(directory, "output.mp4");
  try {
    const generate = spawn(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=2:d=2",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=2:d=2",
      "-f", "lavfi", "-i", "color=c=green:s=160x90:r=2:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=6",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", source],
    { windowsHide: true, stdio: "ignore" });
    assert.equal((await once(generate, "exit"))[0], 0);
    const result = await renderComposition(source, target, [
      { inFrame: 8, outFrame: 12, startSeconds: 4, endSeconds: 6 },
      { inFrame: 0, outFrame: 4, startSeconds: 0, endSeconds: 2 },
      { inFrame: 4, outFrame: 6, startSeconds: 2, endSeconds: 3 },
    ], new AbortController().signal);
    assert.equal(result.frameCount, 10);
    assert.ok(Math.abs(result.duration - 5) < .3);
    assert.equal(result.audio, true);
    const sample = async (seconds: number) => {
      const child = spawn(ffmpeg, ["-v", "error", "-ss", String(seconds), "-i", target,
        "-frames:v", "1", "-vf", "scale=1:1,format=rgb24", "-f", "rawvideo", "pipe:1"],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      assert.equal((await once(child, "exit"))[0], 0);
      return Buffer.concat(chunks);
    };
    const green = await sample(.1), red = await sample(2.1), blue = await sample(4.1);
    assert.ok(green[1] > green[0] + 50 && green[1] > green[2] + 50, `first segment should be green: ${green}`);
    assert.ok(red[0] > red[1] + 50 && red[0] > red[2] + 50, `second segment should be red: ${red}`);
    assert.ok(blue[2] > blue[0] + 50 && blue[2] > blue[1] + 50, `third segment should be blue: ${blue}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
