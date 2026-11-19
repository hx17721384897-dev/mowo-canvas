import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { frameExtractionSources, videoFrameJobs } from "../../assets/server/schema.ts";
import { dirname, join, relative, resolve } from "node:path";
import { VideoFrameJobStore } from "./video-frame-job-store.ts";
import { readyVideoFrameIndex, resolveVideoFrameSource, videoFramePath } from "./video-frame-source.ts";
import { buildVideoFrameIndex, runVideoFrames, VideoFrameRuntimeError } from "./video-frame-runtime.ts";
import { VideoFrameJobError, type VideoFrameJob } from "../video-frame-jobs.ts";
import { VIDEO_FRAME_LIMITS } from "../video-frame-policy.ts";

export class VideoFrameExecutor {
  readonly store: VideoFrameJobStore;
  readonly root: string;
  private active?: { abort: AbortController; done: Promise<void> };
  get busy() { return Boolean(this.active); }
  constructor(store: VideoFrameJobStore, root: string) { this.store = store; this.root = resolve(root); }

  async initialize() {
    // Existing run-app guardian owns/reaps this coordinator's old process tree first.
    this.store.interruptPending();
    await rm(videoFramePath(this.root, "temp/video-frame-work"), { recursive: true, force: true });
    for (const job of this.store.db.select().from(videoFrameJobs).where(eq(videoFrameJobs.mode, "extract")).all()) {
      const directory = videoFramePath(this.root, `temp/frame-extraction/${job.id}`);
      const known = new Set(this.store.db.select({ id: frameExtractionSources.id }).from(frameExtractionSources)
        .where(eq(frameExtractionSources.taskId, job.id)).all().map((source) => source.id));
      const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name) && !known.has(entry.name)) {
        await rm(videoFramePath(this.root, `temp/frame-extraction/${job.id}/${entry.name}`), { recursive: true, force: true });
      }
    }
  }

  pump() {
    if (this.active) return;
    const next = this.store.claimNext();
    if (!next) return;
    const abort = new AbortController();
    const done = this.execute(next.job, next.executionId, abort).finally(() => { this.active = undefined; });
    this.active = { abort, done };
    void done.catch(() => {});
  }
  async stop() { this.active?.abort.abort(); await this.active?.done; }

  private async execute(job: VideoFrameJob, executionId: string, abort: AbortController) {
    const work = videoFramePath(this.root, `temp/video-frame-work/${job.id}/${executionId}`);
    const monitor = setInterval(() => {
      try { if (this.store.row(job.projectId, job.id).status !== "running") abort.abort(); }
      catch { abort.abort(); }
    }, 200);
    try {
      await mkdir(work, { recursive: true });
      for (let index = 0; index < job.inputs.length; index += 1) {
        if (abort.signal.aborted) break;
        const input = this.store.get(job.projectId, job.id).inputs[index];
        if (["ready", "analyzed"].includes(input.status)) continue;
        let target: string | undefined, committed = false;
        try {
          this.store.patchInput(job.projectId, job.id, executionId, index, { status: "running", stage: "indexing", completed: 0, total: 0 });
          const source = resolveVideoFrameSource(this.store.db, this.root, job.projectId, input.assetId);
          const actualPath = await realpath(source.sourcePath);
          videoFramePath(await realpath(this.root), actualPath);
          if (source.endFrame === undefined && (await stat(actualPath)).size > VIDEO_FRAME_LIMITS.maxBytes) {
            throw new VideoFrameRuntimeError("SIZE_LIMIT");
          }
          let metadata = await readyVideoFrameIndex(source);
          if (!metadata) {
            const temporary = join(work, `${index}-index.sqlite`);
            await buildVideoFrameIndex(actualPath, temporary, source.contentHash, work, abort.signal);
            await mkdir(dirname(source.indexPath), { recursive: true });
            await rename(temporary, source.indexPath);
            metadata = await readyVideoFrameIndex(source);
          }
          if (!metadata) throw new VideoFrameRuntimeError("STALE_INDEX");
          let lastProgress = 0;
          const output = await runVideoFrames({ ...source, sourcePath: actualPath, endFrame: source.endFrame ?? metadata.frameCount }, input.settings, {
            tempRoot: work, extract: job.mode === "extract", signal: abort.signal,
            onProgress: (progress) => {
              if (Date.now() - lastProgress < 200 && progress.completed !== progress.total) return;
              lastProgress = Date.now();
              this.store.patchInput(job.projectId, job.id, executionId, index, progress);
            },
          });
          try {
            const result = output.result;
            if (source.contentHash !== result.sourceContentHash) throw new VideoFrameRuntimeError("SOURCE_CHANGED");
            this.store.patchInput(job.projectId, job.id, executionId, index, {
              analysis: { width: result.width, height: result.height, durationMs: result.durationMs, preparedBytes: result.preparedBytes,
                sourceFrameCount: result.sourceEndFrame - result.sourceStartFrame,
                sourceStartFrame: result.sourceStartFrame,
                sourceFps: (result.sourceEndFrame - result.sourceStartFrame) * 1000 / result.durationMs,
                estimatedFrameCount: result.estimatedFrameCount, recommendation: result.recommendation,
                targetFps: result.targetFps, timingErrorMs: result.timingErrorMs, issue: result.issue },
            });
            abort.signal.throwIfAborted();
            if (job.mode === "analyze" || (input.settings.deferOutput && result.issue)) {
              this.store.patchInput(job.projectId, job.id, executionId, index, { status: "analyzed" });
            } else {
              const sourceId = randomUUID();
              target = videoFramePath(this.root, `temp/frame-extraction/${job.id}/${sourceId}`);
              await mkdir(target, { recursive: true });
              const unique = [...new Set(result.frames.map((frame) => frame.file!))];
              for (const file of unique) {
                abort.signal.throwIfAborted();
                await rename(join(output.directory, file), join(target, file));
              }
              const paths = result.frames.map((frame) => relative(this.root, join(target!, frame.file!)).replaceAll("\\", "/"));
              committed = this.store.publish(job.projectId, job.id, executionId, index, result, sourceId, paths) === sourceId;
            }
          } finally { await output.dispose(); }
        } catch (error) {
          if (abort.signal.aborted) break;
          const code = error instanceof VideoFrameRuntimeError || error instanceof VideoFrameJobError ? error.code : "PROCESSING_FAILED";
          try { this.store.patchInput(job.projectId, job.id, executionId, index, { status: "failed", errorCode: code }); }
          catch { abort.abort(); }
        } finally { if (target && !committed) await rm(target, { recursive: true, force: true }); }
      }
    } finally {
      clearInterval(monitor);
      if (abort.signal.aborted && this.store.row(job.projectId, job.id).status === "running") this.store.requestCancel(job.projectId, job.id);
      this.store.finish(job.projectId, job.id, executionId);
      await rm(work, { recursive: true, force: true });
    }
  }
}
