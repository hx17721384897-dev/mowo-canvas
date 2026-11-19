import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../assets/server/schema.ts";
import { confirmVideoFrameJobSchema, createVideoFrameJobSchema, VideoFrameJobError, type VideoFrameJob, type VideoFrameJobInput } from "../video-frame-jobs.ts";
import type { VideoFrameResult } from "../video-frame-result.ts";

type DB = BetterSQLite3Database<typeof schema>;
const { videoFrameJobs: jobs, frameExtractionTasks: tasks, frameExtractionSources: sources, frameExtractionFrames: frames } = schema;
type Row = typeof jobs.$inferSelect;
const active = ["queued", "running", "cancelling"] as const;
const success = (input: VideoFrameJobInput) => input.status === "analyzed" || input.status === "ready";

export class VideoFrameJobStore {
  readonly db: DB;
  constructor(db: DB) { this.db = db; }

  row(projectId: string, jobId: string) {
    const row = this.db.select().from(jobs).where(and(eq(jobs.projectId, projectId), eq(jobs.id, jobId))).get();
    if (!row) throw new VideoFrameJobError("JOB_NOT_FOUND", 404);
    return row;
  }

  view(row: Row): VideoFrameJob {
    return { id: row.id, projectId: row.projectId, nodeId: row.nodeId, requestId: row.requestId,
      mode: row.mode, status: row.status, inputs: JSON.parse(row.inputsJson) as VideoFrameJobInput[],
      resultTaskId: row.resultTaskId, errorCode: row.errorCode, updatedAt: row.updatedAt.toISOString() };
  }
  get(projectId: string, jobId: string) { return this.view(this.row(projectId, jobId)); }
  list(projectId: string, nodeId?: string) {
    return this.db.select().from(jobs).where(and(eq(jobs.projectId, projectId), nodeId ? eq(jobs.nodeId, nodeId) : undefined))
      .orderBy(asc(jobs.createdAt)).all().slice(-100).map((row) => this.view(row));
  }

  create(projectId: string, value: unknown) {
    const parsed = createVideoFrameJobSchema.safeParse(value);
    if (!parsed.success) throw new VideoFrameJobError("INVALID_INPUT");
    const body = parsed.data;
    const normalized = { nodeId: body.nodeId, mode: body.mode,
      inputs: body.inputs.map((input) => ({ assetId: input.assetId, settings: input.settings ?? body.settings })) };
    const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    return this.db.transaction(() => {
      const previous = this.db.select().from(jobs).where(and(eq(jobs.projectId, projectId), eq(jobs.requestId, body.requestId))).get();
      if (previous) {
        if (previous.requestHash !== hash) throw new VideoFrameJobError("REQUEST_CONFLICT", 409);
        return this.view(previous);
      }
      if (!this.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()) throw new VideoFrameJobError("PROJECT_NOT_FOUND", 404);
      this.checkNodeIdle(projectId, body.nodeId);
      const inputs = normalized.inputs.map((input): VideoFrameJobInput => {
        const asset = this.db.select({ asset: schema.assets }).from(schema.projectAssets)
          .innerJoin(schema.assets, eq(schema.assets.id, schema.projectAssets.assetId))
          .where(and(eq(schema.projectAssets.projectId, projectId), eq(schema.assets.id, input.assetId), isNull(schema.assets.deletedAt))).get()?.asset;
        if (!asset || asset.type !== "video") throw new VideoFrameJobError("VIDEO_UNAVAILABLE");
        return { ...input, name: asset.originalName, status: "pending" };
      });
      const id = randomUUID(), now = new Date();
      this.db.insert(jobs).values({ id, projectId, nodeId: body.nodeId, requestId: body.requestId,
        requestHash: hash, mode: body.mode, status: "queued", inputsJson: JSON.stringify(inputs), createdAt: now, updatedAt: now }).run();
      return this.get(projectId, id);
    }, { behavior: "immediate" });
  }

  private checkNodeIdle(projectId: string, nodeId: string) {
    if (this.db.select().from(jobs).where(and(eq(jobs.projectId, projectId), eq(jobs.nodeId, nodeId), inArray(jobs.status, [...active]))).get()) {
      throw new VideoFrameJobError("NODE_BUSY", 409);
    }
  }

  claimNext() {
    return this.db.transaction(() => {
      // A single executor across connections, even if two coordinators accidentally poll.
      if (this.db.select().from(jobs).where(inArray(jobs.status, ["running", "cancelling"])).get()) return null;
      const row = this.db.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.createdAt)).get();
      if (!row) return null;
      const executionId = randomUUID();
      this.db.update(jobs).set({ status: "running", executionId, updatedAt: new Date() }).where(eq(jobs.id, row.id)).run();
      return { job: this.get(row.projectId, row.id), executionId };
    }, { behavior: "immediate" });
  }

  private live(projectId: string, jobId: string, executionId: string) {
    const row = this.row(projectId, jobId);
    if (row.executionId !== executionId || row.status !== "running") throw new VideoFrameJobError("STALE_EXECUTION", 409);
    return row;
  }

  patchInput(projectId: string, jobId: string, executionId: string, index: number, patch: Partial<VideoFrameJobInput>) {
    this.db.transaction(() => {
      const row = this.live(projectId, jobId, executionId), inputs = JSON.parse(row.inputsJson) as VideoFrameJobInput[];
      if (!inputs[index] || success(inputs[index])) return;
      inputs[index] = { ...inputs[index], ...patch };
      this.db.update(jobs).set({ inputsJson: JSON.stringify(inputs), updatedAt: new Date() }).where(eq(jobs.id, jobId)).run();
    }, { behavior: "immediate" });
  }

  publish(projectId: string, jobId: string, executionId: string, index: number, result: VideoFrameResult,
    sourceId: string, paths: string[]) {
    return this.db.transaction(() => {
      const row = this.live(projectId, jobId, executionId), inputs = JSON.parse(row.inputsJson) as VideoFrameJobInput[];
      const input = inputs[index];
      if (input?.status === "ready") return input.sourceId;
      if (!input || row.mode !== "extract" || !result.frames.length || result.issue || paths.length !== result.frames.length) {
        throw new VideoFrameJobError("INVALID_WORKER_RESULT");
      }
      const taskId = row.resultTaskId ?? jobId, now = new Date();
      if (!row.resultTaskId) this.db.insert(tasks).values({ id: taskId, projectId, status: "processing", createdAt: now, updatedAt: now, expiresAt: new Date("9999-12-31") }).run();
      this.db.insert(sources).values({ id: sourceId, taskId, sourceAssetId: input.assetId, position: index, status: "ready",
        name: input.name, sourceKind: "video", width: result.width, height: result.height,
        totalDurationMs: Math.round(result.durationMs), parametersJson: JSON.stringify({ ...input.settings,
          algorithmVersion: result.algorithmVersion, sourceContentHash: result.sourceContentHash,
          sourceStartFrame: result.sourceStartFrame, sourceEndFrame: result.sourceEndFrame,
          sourceStartPts: result.sourceStartPts, sourceEndPts: result.sourceEndPts,
          timeBaseNumerator: result.timeBaseNumerator, timeBaseDenominator: result.timeBaseDenominator,
          resolvedTargetFps: result.targetFps, timingErrorMs: result.timingErrorMs }) }).run();
      this.db.insert(frames).values(result.frames.map((frame, position) => {
        const start = Math.round(frame.timelineStartMs);
        const end = Math.round(position + 1 < result.frames.length ? result.frames[position + 1].timelineStartMs : result.durationMs);
        if (end <= start) throw new VideoFrameJobError("INVALID_FRAME_DURATION");
        return { id: randomUUID(), sourceId, sourcePosition: frame.sourcePosition, position, relativePath: paths[position],
          width: result.width, height: result.height, retained: true, timelineStartMs: start, durationMs: end - start,
          sourceMappingJson: JSON.stringify({ sourceStartFrame: frame.sourceStartFrame, sourceEndFrame: frame.sourceEndFrame, sourcePts: frame.sourcePts }) };
      })).run();
      inputs[index] = { ...input, status: "ready", sourceId, errorCode: undefined };
      this.db.update(jobs).set({ resultTaskId: taskId, inputsJson: JSON.stringify(inputs), updatedAt: now }).where(eq(jobs.id, jobId)).run();
      this.db.update(tasks).set({ status: "processing", updatedAt: now }).where(eq(tasks.id, taskId)).run();
      return sourceId;
    }, { behavior: "immediate" });
  }

  requestCancel(projectId: string, jobId: string) {
    return this.db.transaction(() => {
      const row = this.row(projectId, jobId);
      if (!active.includes(row.status as typeof active[number])) return this.view(row);
      const inputs = JSON.parse(row.inputsJson) as VideoFrameJobInput[];
      if (row.status === "queued") inputs.forEach((input) => { if (!success(input)) input.status = "cancelled"; });
      this.db.update(jobs).set({ status: row.status === "queued" ? "cancelled" : "cancelling",
        inputsJson: JSON.stringify(inputs), updatedAt: new Date() }).where(eq(jobs.id, jobId)).run();
      return this.get(projectId, jobId);
    }, { behavior: "immediate" });
  }

  finish(projectId: string, jobId: string, executionId: string, interrupted = false) {
    this.db.transaction(() => {
      const row = this.row(projectId, jobId);
      if (row.executionId !== executionId || !["running", "cancelling"].includes(row.status)) return;
      const inputs = JSON.parse(row.inputsJson) as VideoFrameJobInput[];
      const cancelled = row.status === "cancelling";
      for (const input of inputs) if (["pending", "running"].includes(input.status)) {
        input.status = cancelled ? "cancelled" : "failed"; input.errorCode = cancelled ? "CANCELLED" : "INTERRUPTED";
      }
      const count = inputs.filter(success).length;
      const status = cancelled ? "cancelled" : count === inputs.length ? "ready" : count ? "partial" : "failed";
      this.db.update(jobs).set({ status, inputsJson: JSON.stringify(inputs), executionId: null,
        errorCode: interrupted ? "INTERRUPTED" : cancelled ? "CANCELLED" : null, updatedAt: new Date() }).where(eq(jobs.id, jobId)).run();
      if (row.resultTaskId) {
        const groups = this.db.select().from(sources).where(eq(sources.taskId, row.resultTaskId)).all();
        this.db.update(tasks).set({ status: groups.every((source) => source.status === "saved") ? "saved" : count === inputs.length ? "ready" : "partial",
          updatedAt: new Date() }).where(eq(tasks.id, row.resultTaskId)).run();
      }
    }, { behavior: "immediate" });
  }

  confirm(projectId: string, jobId: string, value: unknown) {
    const parsed = confirmVideoFrameJobSchema.safeParse(value);
    if (!parsed.success) throw new VideoFrameJobError("INVALID_INPUT");
    return this.db.transaction(() => {
      const row = this.row(projectId, jobId);
      if (row.mode !== "extract") throw new VideoFrameJobError("INVALID_INPUT");
      const inputs = JSON.parse(row.inputsJson) as VideoFrameJobInput[];
      // A lost PATCH response may be replayed after polling/reload. Never requeue a published source.
      const same = parsed.data.inputs.every(item => inputs.some(input => input.assetId === item.assetId
        && JSON.stringify(input.settings) === JSON.stringify(item.settings)
        && ["pending", "running", "ready"].includes(input.status)));
      if (same) return this.view(row);
      this.checkNodeIdle(projectId, row.nodeId);
      for (const item of parsed.data.inputs) {
        const input = inputs.find(input => input.assetId === item.assetId);
        if (!input || input.status !== "analyzed" || !input.analysis?.issue) throw new VideoFrameJobError("INVALID_INPUT");
        Object.assign(input, { settings: item.settings, status: "pending" });
        delete input.analysis; delete input.errorCode; delete input.stage; delete input.completed; delete input.total;
      }
      this.db.update(jobs).set({ status: "queued", inputsJson: JSON.stringify(inputs), errorCode: null,
        updatedAt: new Date() }).where(eq(jobs.id, jobId)).run();
      return this.get(projectId, jobId);
    }, { behavior: "immediate" });
  }

  retry(projectId: string, jobId: string) {
    return this.db.transaction(() => {
      const row = this.row(projectId, jobId);
      if (["queued", "running"].includes(row.status)) return this.view(row);
      if (!["failed", "partial", "cancelled"].includes(row.status)) throw new VideoFrameJobError("JOB_NOT_RETRYABLE", 409);
      this.checkNodeIdle(projectId, row.nodeId);
      const inputs = JSON.parse(row.inputsJson) as VideoFrameJobInput[];
      inputs.forEach((input) => { if (!success(input)) { input.status = "pending"; delete input.errorCode; delete input.stage; delete input.analysis; delete input.completed; delete input.total; } });
      this.db.update(jobs).set({ status: "queued", executionId: null, errorCode: null, inputsJson: JSON.stringify(inputs), updatedAt: new Date() }).where(eq(jobs.id, jobId)).run();
      return this.get(projectId, jobId);
    }, { behavior: "immediate" });
  }

  interruptPending() {
    const rows = this.db.select().from(jobs).where(inArray(jobs.status, ["running", "cancelling"])).all();
    for (const row of rows) if (row.executionId) this.finish(row.projectId, row.id, row.executionId, true);
  }
}
