import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { videoFrameResultSchema, videoFrameSettingsSchema, type VideoFrameResult, type VideoFrameSettings } from "../video-frame-result.ts";

export type IndexedVideoFrameInput = {
  sourcePath: string; indexPath: string; startFrame: number; endFrame: number;
};
export type VideoFrameProgress = { stage: "preparing" | "analyzing" | "extracting"; completed: number; total: number };

/** Indexes in an execution-owned directory, then the executor publishes the cache atomically. */
export async function buildVideoFrameIndex(sourcePath: string, indexPath: string, contentHash: string, parent: string, signal: AbortSignal) {
  const runtime = JSON.parse(await readFile(join(process.cwd(), "scripts/video/python-runtime.json"), "utf8")) as { directory: string };
  if (!/^python-[\d.]+$/.test(runtime.directory)) throw new VideoFrameRuntimeError("INVALID_RUNTIME");
  await new Promise<void>((accept, reject) => {
    const child = spawn(join(process.cwd(), "data/video-runtime", runtime.directory, "python.exe"),
      ["-I", join(process.cwd(), "scripts/video/frame_sequence.py"), "--source", sourcePath, "--index", indexPath,
        "--parent", parent, "--build-index", "--content-hash", contentHash],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false, unavailable = false;
    const abort = () => { child.kill(); };
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 610000);
    child.stdout.resume(); child.stderr.resume();
    child.once("error", () => { unavailable = true; });
    if (signal.aborted) abort();
    // Wait for close (not AbortError) so Windows releases the temporary SQLite file before cleanup.
    child.once("close", (code) => {
      clearTimeout(timeout); signal.removeEventListener("abort", abort);
      if (code === 0 && !signal.aborted && !timedOut && !unavailable) accept();
      else reject(new VideoFrameRuntimeError(signal.aborted ? "CANCELLED" : timedOut ? "TIMEOUT" : "INDEX_FAILED"));
    });
  });
}

export class VideoFrameRuntimeError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** Caller transfers successful files into its draft, then calls dispose(). */
export async function runVideoFrames(input: IndexedVideoFrameInput, settings: VideoFrameSettings, options: {
  tempRoot: string; extract: boolean; signal: AbortSignal; onProgress?: (progress: VideoFrameProgress) => void;
}): Promise<{ directory: string; result: VideoFrameResult; dispose: () => Promise<void> }> {
  const parsed = videoFrameSettingsSchema.parse(settings);
  if (!Number.isSafeInteger(input.startFrame) || !Number.isSafeInteger(input.endFrame)
    || input.startFrame < 0 || input.endFrame <= input.startFrame) throw new VideoFrameRuntimeError("INVALID_RANGE");
  options.signal.throwIfAborted();
  const runtime = JSON.parse(await readFile(join(process.cwd(), "scripts/video/python-runtime.json"), "utf8")) as { directory: string };
  if (!/^python-[\d.]+$/.test(runtime.directory)) throw new VideoFrameRuntimeError("INVALID_RUNTIME");
  await mkdir(options.tempRoot, { recursive: true });
  const parent = await mkdtemp(join(options.tempRoot, "video-frame-job-"));
  const dispose = () => rm(parent, { recursive: true, force: true });
  try {
    const args = ["-I", join(process.cwd(), "scripts/video/frame_sequence.py"), "--source", input.sourcePath,
      "--index", input.indexPath, "--parent", parent, "--start", String(input.startFrame), "--end", String(input.endFrame),
      "--every", String(parsed.every), "--keep", String(parsed.keep)];
    if (parsed.restore) args.push("--restore");
    if (parsed.truncate) args.push("--truncate");
    if (parsed.deferOutput) args.push("--defer-output");
    if (parsed.targetFps !== undefined) args.push("--target-fps", String(parsed.targetFps));
    if (options.extract) args.push("--extract");
    const directory = await new Promise<string>((resolve, reject) => {
      const child = spawn(join(process.cwd(), "data/video-runtime", runtime.directory, "python.exe"), args,
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUTF8: "1" } });
      let buffer = "", ready = "", failure = "";
      const stop = (code: string) => { failure ||= code; child.kill(); };
      const abort = () => stop("CANCELLED");
      options.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => stop("TIMEOUT"), 610_000);
      if (options.signal.aborted) abort();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 64 * 1024) { stop("INVALID_WORKER_RESPONSE"); return; }
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === "ready" && typeof event.directory === "string") ready = event.directory;
            else if (event.type === "failed" && typeof event.code === "string") failure ||= event.code;
            else if (event.type === "progress" && ["preparing", "analyzing", "extracting"].includes(String(event.stage))
              && Number.isSafeInteger(event.completed) && Number.isSafeInteger(event.total)) {
              options.onProgress?.({ stage: event.stage as VideoFrameProgress["stage"], completed: Number(event.completed), total: Number(event.total) });
            } else stop("INVALID_WORKER_RESPONSE");
          } catch { stop("INVALID_WORKER_RESPONSE"); }
        }
      });
      // Drain stderr, but do not disclose local paths/codec internals as product errors.
      child.stderr.resume();
      child.once("error", () => { failure ||= "WORKER_UNAVAILABLE"; });
      child.once("close", (code) => {
        clearTimeout(timeout); options.signal.removeEventListener("abort", abort);
        if (code !== 0 || !ready || failure) reject(new VideoFrameRuntimeError(failure || "PROCESSING_FAILED"));
        else resolve(ready);
      });
    });
    options.signal.throwIfAborted();
    const canonical = await realpath(directory), canonicalParent = await realpath(parent);
    const inside = relative(canonicalParent, canonical);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new VideoFrameRuntimeError("INVALID_OUTPUT_PATH");
    const result = videoFrameResultSchema.parse(JSON.parse(await readFile(join(canonical, "manifest.json"), "utf8")));
    if (options.extract && !(parsed.deferOutput && result.issue) && (result.issue || result.frames.some((frame) => !frame.file))) throw new VideoFrameRuntimeError("INVALID_WORKER_RESULT");
    return { directory: canonical, result, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
