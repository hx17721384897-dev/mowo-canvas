import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../assets/server/schema.ts";
import { activeVideoStatuses, createVideoTaskSchema, idSchema, normalizeVideoUrl, videoMediaSchema, videoWorkerEventSchema } from "../types.ts";
import type { VideoTaskSummary } from "../types.ts";

const tasks = schema.videoDownloadTasks;
type Row = typeof tasks.$inferSelect;
const errors = {
  INVALID_INPUT: [400, "视频链接或下载选项无效"], INVALID_JSON: [400, "请求内容不是有效 JSON"],
  INVALID_EVENT: [400, "视频处理结果格式无效"], LOCAL_ONLY: [403, "只允许本机同源请求"],
  PROJECT_NOT_FOUND: [404, "项目不存在"], TASK_NOT_FOUND: [404, "找不到该项目的视频任务"],
  TASK_BUSY: [409, "任务正在处理，请等待停止后再操作"], INVALID_STATE: [409, "当前任务状态不支持此操作"],
  BODY_TOO_LARGE: [413, "请求内容过大"], INTERNAL_ERROR: [500, "视频任务操作失败，请稍后重试"],
  DOWNLOAD_FAILED: [502, "视频处理失败，可以重试"], INTERRUPTED: [409, "上次处理已中断，请重试"],
  FORMAT_UNAVAILABLE: [409, "所选格式已不可用，请重新解析视频"], PLATFORM_REJECTED: [502, "平台暂时拒绝请求，请稍后重试"],
  RESUME_UNVERIFIED: [409, "无法确认部分文件可续下，请明确重新下载"], FILE_MISSING: [409, "下载文件不存在，请重新下载"],
  PREVIEW_FAILED: [409, "原片已保留，兼容预览生成失败，可以重试"], HDR_PREVIEW_UNSUPPORTED: [409, "当前不支持 HDR 兼容预览，原片仍可入库"],
  SERVICE_UNAVAILABLE: [503, "下载服务尚未启动，请重新启动应用"], RESOLVE_EXPIRED: [409, "解析结果已过期，请重新解析"],
  AUTH_FAILED: [502, "登录操作失败，请刷新或稍后重试"], RESOLVE_FAILED: [502, "视频解析失败，请检查链接或稍后重试"],
  DISK_FULL: [409, "磁盘可用空间不足，请释放空间后重试"],
  IMPORT_FAILED: [500, "入库失败，原片已保留，可以重试"], MEDIA_CHANGED: [409, "原片内容与校验结果不一致，请重新下载"],
  ASSET_UNAVAILABLE: [409, "相同资产不可用或在回收站中，请先恢复"],
  CLEANUP_FAILED: [409, "临时文件无法安全清理，已保留文件，请稍后重试"],
  ASSET_FILE_MISSING: [409, "正式原片缺失，请恢复素材备份；临时文件已保留"],
} as const;
export type VideoTaskErrorCode = keyof typeof errors;
export class VideoTaskError extends Error {
  readonly code: VideoTaskErrorCode;
  readonly status: number;
  constructor(code: VideoTaskErrorCode) { super(errors[code][1]); this.code = code; this.status = errors[code][0]; }
}
const active = (row: Row) => (activeVideoStatuses as readonly string[]).includes(row.status);

export class VideoTaskStore {
  private readonly database: BetterSQLite3Database<typeof schema>;
  constructor(database: BetterSQLite3Database<typeof schema>) { this.database = database; }
  private project(projectId: string) {
    if (!idSchema.safeParse(projectId).success) throw new VideoTaskError("INVALID_INPUT");
    if (!this.database.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId)).get()) throw new VideoTaskError("PROJECT_NOT_FOUND");
  }
  private row(projectId: string, id: string) {
    if (!idSchema.safeParse(projectId).success || !idSchema.safeParse(id).success) throw new VideoTaskError("INVALID_INPUT");
    const row = this.database.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.projectId, projectId))).get();
    if (!row) throw new VideoTaskError("TASK_NOT_FOUND");
    return row;
  }
  private view(row: Row): VideoTaskSummary {
    const error = row.errorCode && Object.hasOwn(errors, row.errorCode) ? errors[row.errorCode as VideoTaskErrorCode][1] : null;
    const media = row.metadataJson ? videoMediaSchema.parse(JSON.parse(row.metadataJson)) : null;
    const content = ["ready", "completed"].includes(row.status) ? `/api/projects/${encodeURIComponent(row.projectId)}/video-downloads/${encodeURIComponent(row.id)}/content` : null;
    return { id: row.id, projectId: row.projectId, sourceUrl: row.sourceUrl, bvid: row.bvid, part: row.part,
      title: row.title, formatIds: JSON.parse(row.formatIdsJson), status: row.status,
      progress: { downloadedBytes: row.downloadedBytes, totalBytes: row.totalBytes, speed: row.speed },
      previewStatus: row.previewStatus, recoveryMode: row.recoveryMode, retryCount: row.retryCount,
      assetId: row.assetId, media, originalUrl: row.assetId ? `/api/assets/${row.assetId}/content` : content ? `${content}?kind=source` : null,
      coverUrl: row.assetId ? `/api/assets/${row.assetId}/cover` : content ? `${content}?kind=cover` : null,
      previewUrl: content && (row.previewStatus === "ready" || media?.browserCandidate) ? row.assetId ? `/api/assets/${row.assetId}/preview` : `${content}?kind=${row.previewStatus === "ready" ? "preview" : "source"}` : null,
      errorCode: row.errorCode, errorMessage: error, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  get(projectId: string, id: string) { return this.view(this.row(projectId, id)); }
  executionSource(projectId: string, id: string) { return this.row(projectId, id); }
  setCid(projectId: string, id: string, cid: string) {
    this.row(projectId, id);
    this.database.update(tasks).set({ cid }).where(eq(tasks.id, id)).run();
  }
  nextQueued() { return this.database.select().from(tasks).where(eq(tasks.status, "queued")).orderBy(tasks.createdAt).limit(1).get(); }
  nextPreview() { return this.database.select().from(tasks).where(and(inArray(tasks.status, ["ready", "completed"]), eq(tasks.previewStatus, "pending"))).orderBy(tasks.createdAt).limit(1).get(); }
  requestPreview(projectId: string, id: string) {
    const row = this.row(projectId, id);
    if (!["ready", "completed"].includes(row.status)) throw new VideoTaskError("INVALID_STATE");
    if (row.previewStatus !== "generating") this.database.update(tasks).set({ previewStatus: "pending", errorCode: null, updatedAt: new Date() }).where(eq(tasks.id, id)).run();
    return this.get(projectId, id);
  }
  list(projectId: string) {
    this.project(projectId);
    return this.database.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(100).all().map(row => this.view(row));
  }
  create(projectId: string, input: unknown) {
    const parsed = createVideoTaskSchema.safeParse(input);
    if (!parsed.success) throw new VideoTaskError("INVALID_INPUT");
    let source: ReturnType<typeof normalizeVideoUrl>;
    try { source = normalizeVideoUrl(parsed.data.url); } catch { throw new VideoTaskError("INVALID_INPUT"); }
    return this.database.transaction(() => {
      this.project(projectId);
      const id = randomUUID(); const now = new Date();
      this.database.insert(tasks).values({ id, projectId, ...source, title: parsed.data.title ?? source.bvid,
        formatIdsJson: JSON.stringify(parsed.data.formatIds), createdAt: now, updatedAt: now }).run();
      return this.get(projectId, id);
    }, { behavior: "immediate" });
  }
  private busy() {
    return !!this.database.select({ id: tasks.id }).from(tasks)
      .where(or(inArray(tasks.status, [...activeVideoStatuses]), eq(tasks.previewStatus, "generating"))).limit(1).get();
  }
  claim(projectId: string, id: string) {
    return this.database.transaction(() => {
      const row = this.row(projectId, id);
      if (row.status !== "queued") throw new VideoTaskError("INVALID_STATE");
      if (this.busy()) throw new VideoTaskError("TASK_BUSY");
      const executionId = randomUUID();
      this.database.update(tasks).set({ status: "downloading", executionId, errorCode: null, updatedAt: new Date() }).where(eq(tasks.id, id)).run();
      return { task: this.get(projectId, id), executionId };
    }, { behavior: "immediate" });
  }
  retry(projectId: string, id: string) {
    return this.database.transaction(() => {
      const row = this.row(projectId, id);
      if (row.status === "queued") return this.view(row);
      if (!["failed", "interrupted", "cancelled"].includes(row.status) || row.previewStatus === "generating") throw new VideoTaskError("INVALID_STATE");
      this.database.update(tasks).set({ status: "queued", executionId: null, retryCount: row.retryCount + 1,
        errorCode: null, metadataJson: null, relativePath: null, previewStatus: "pending", recoveryMode: null,
        downloadedBytes: null, totalBytes: null, speed: null, updatedAt: new Date() }).where(eq(tasks.id, id)).run();
      return this.get(projectId, id);
    }, { behavior: "immediate" });
  }
  cancelIdle(projectId: string, id: string) {
    return this.database.transaction(() => {
      const row = this.row(projectId, id);
      if (active(row) || row.previewStatus === "generating") throw new VideoTaskError("TASK_BUSY");
      if (row.status === "cancelled") return this.view(row);
      if (!["queued", "failed", "interrupted"].includes(row.status)) throw new VideoTaskError("INVALID_STATE");
      this.database.update(tasks).set({ status: "cancelled", executionId: null, errorCode: null, speed: null, updatedAt: new Date() }).where(eq(tasks.id, id)).run();
      return this.get(projectId, id);
    }, { behavior: "immediate" });
  }
  discard(projectId: string, id: string) {
    return this.database.transaction(() => {
      const row = this.row(projectId, id);
      if (row.status === "cancelled") return this.view(row);
      if (row.status !== "ready" || row.previewStatus === "generating") throw new VideoTaskError("INVALID_STATE");
      this.database.update(tasks).set({ status: "cancelled", executionId: null, updatedAt: new Date() }).where(eq(tasks.id, id)).run();
      return this.get(projectId, id);
    }, { behavior: "immediate" });
  }
  // Call only after the managed Promise has closed its process tree.
  cancelExecution(projectId: string, id: string, executionId: string) {
    return this.database.transaction(() => {
    const row = this.row(projectId, id);
    if (!executionId || row.executionId !== executionId) return false;
    if (!active(row) && row.previewStatus !== "generating") return false;
    this.database.update(tasks).set({ status: active(row) ? "cancelled" : row.status,
      previewStatus: row.previewStatus === "generating" ? "failed" : row.previewStatus,
      executionId: null, errorCode: null, speed: null, updatedAt: new Date() }).where(and(eq(tasks.id, id), eq(tasks.executionId, executionId))).run();
    return true;
    }, { behavior: "immediate" });
  }
  beginPreview(projectId: string, id: string) {
    return this.database.transaction(() => {
      const row = this.row(projectId, id);
      if (!["ready", "completed"].includes(row.status) || !["pending", "failed"].includes(row.previewStatus)) throw new VideoTaskError("INVALID_STATE");
      if (this.busy()) throw new VideoTaskError("TASK_BUSY");
      const executionId = randomUUID();
      this.database.update(tasks).set({ executionId, previewStatus: "generating", errorCode: null, updatedAt: new Date() }).where(eq(tasks.id, id)).run();
      return executionId;
    }, { behavior: "immediate" });
  }
  applyEvent(projectId: string, id: string, executionId: string, input: unknown) {
    return this.database.transaction(() => {
      const row = this.row(projectId, id);
      if (!executionId || row.executionId !== executionId) return false;
      const parsed = videoWorkerEventSchema.safeParse(input);
      if (!parsed.success) throw new VideoTaskError("INVALID_EVENT");
      const event = parsed.data;
      let update: Partial<typeof tasks.$inferInsert>;
      switch (event.event) {
        case "managed": case "done": return false; // Process completion does not mean asset import.
        case "stage":
          if (!["downloading", "merging"].includes(row.status) || (row.status === "merging" && event.stage === "downloading")) return false;
          update = { status: event.stage }; break;
        case "progress":
          if (row.status !== "downloading") return false;
          update = { downloadedBytes: event.downloaded, totalBytes: event.total, speed: event.speed === null ? null : Math.round(event.speed) }; break;
        case "recovery":
          if (row.status !== "downloading") return false;
          update = { recoveryMode: event.mode }; break;
        case "downloaded":
          if (!["downloading", "merging"].includes(row.status)) return false;
          update = { status: "verifying", relativePath: `temp/video-downloads/${row.id}/${event.file}`, speed: null }; break;
        case "probed": {
          if (row.status !== "verifying" || !row.relativePath) return false;
          if (!event.streams.some(s => s.codec_type === "video" && s.width && s.height)) throw new VideoTaskError("INVALID_EVENT");
          const media = videoMediaSchema.parse(event);
          update = { status: "ready", executionId: null, metadataJson: JSON.stringify(media), previewStatus: media.browserCandidate ? "not-needed" : "pending" }; break;
        }
        case "previewed":
          if (row.previewStatus !== "generating") return false;
          if (!event.browserCandidate || !event.streams.some(s => s.codec_type === "video" && s.width && s.height)) throw new VideoTaskError("INVALID_EVENT");
          update = { previewStatus: "ready", executionId: null, errorCode: null }; break;
        case "failed":
          if (row.previewStatus === "generating") { update = { previewStatus: "failed", executionId: null,
            errorCode: event.code === "hdr_preview_requires_tonemapping" ? "HDR_PREVIEW_UNSUPPORTED" : event.code === "disk_full" ? "DISK_FULL" : "PREVIEW_FAILED" }; break; }
          if (!active(row)) return false;
          update = { status: "failed", executionId: null, speed: null, errorCode: event.code === "format_unavailable" ? "FORMAT_UNAVAILABLE"
            : event.code === "disk_full" ? "DISK_FULL" : event.code === "platform_rejected" ? "PLATFORM_REJECTED" : event.code.startsWith("resume_") ? "RESUME_UNVERIFIED" : "DOWNLOAD_FAILED" }; break;
      }
      this.database.update(tasks).set({ ...update, updatedAt: new Date() }).where(and(eq(tasks.id, id), eq(tasks.executionId, executionId))).run();
      return true;
    }, { behavior: "immediate" });
  }
  // Startup only, after acquiring the executor lock and reaping the old managed tree.
  interruptPending() {
    return this.database.transaction(() => {
      const pending = this.database.select().from(tasks).where(or(inArray(tasks.status, ["queued", ...activeVideoStatuses]), eq(tasks.previewStatus, "generating"))).all();
      for (const row of pending) {
        const interrupted = row.status === "queued" || active(row);
        this.database.update(tasks).set({ status: interrupted ? "interrupted" : row.status,
          executionId: null, speed: null, errorCode: interrupted ? "INTERRUPTED" : "PREVIEW_FAILED",
          previewStatus: row.previewStatus === "generating" ? "failed" : row.previewStatus, updatedAt: new Date() }).where(eq(tasks.id, row.id)).run();
      }
      return pending.length;
    }, { behavior: "immediate" });
  }
}
