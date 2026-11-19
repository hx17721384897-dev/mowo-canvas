import { z } from "zod";

export const videoTaskStatuses = ["queued", "downloading", "merging", "verifying", "ready", "importing", "completed", "failed", "cancelled", "interrupted"] as const;
export const previewStatuses = ["not-needed", "pending", "generating", "ready", "failed"] as const;
export const activeVideoStatuses = ["downloading", "merging", "verifying", "importing"] as const;
export const idSchema = z.string().min(1).max(120);
const formatId = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
export const createVideoTaskSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  formatIds: z.array(formatId).min(1).max(2).refine(ids => new Set(ids).size === ids.length),
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

export function normalizeVideoUrl(input: string) {
  const value = /^BV[0-9A-Za-z]{10}$/.test(input) ? `https://www.bilibili.com/video/${input}` : input;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["bilibili.com", "www.bilibili.com"].includes(url.hostname)) throw new Error("INVALID_INPUT");
  const match = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
  const parts = url.searchParams.getAll("p"); const part = parts[0] ?? "1";
  if (!match || parts.length > 1 || !/^\d+$/.test(part) || Number(part) < 1 || Number(part) > 10000) throw new Error("INVALID_INPUT");
  return { sourceUrl: `https://www.bilibili.com/video/${match[1]}?p=${Number(part)}`, bvid: match[1], part: Number(part) };
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const base = { v: z.literal(1) };
const stream = z.object({ codec_type: z.string().max(32), codec_name: z.string().max(64).nullable(),
  width: count.nullable(), height: count.nullable(), pix_fmt: z.string().max(64).nullable(), color_transfer: z.string().max(64).nullable() });
export const videoMediaSchema = z.object({ duration: z.number().positive().finite(), streams: z.array(stream).min(1).max(64), browserCandidate: z.boolean() });
export const videoWorkerEventSchema = z.discriminatedUnion("event", [
  z.object({ ...base, event: z.literal("stage"), stage: z.enum(["downloading", "merging"]) }).strict(),
  z.object({ ...base, event: z.literal("progress"), downloaded: count.nullable(), total: count.nullable(), speed: z.number().nonnegative().finite().nullable() }).strict(),
  z.object({ ...base, event: z.literal("recovery"), mode: z.enum(["fresh", "existing", "candidate", "continued", "restarted"]), bytes: count }).strict(),
  z.object({ ...base, event: z.literal("downloaded"), file: z.string().regex(/^source\.(mp4|mkv|webm)$/), requireAudio: z.boolean().optional() }).strict(),
  videoMediaSchema.extend({ ...base, event: z.literal("probed") }).strict(),
  videoMediaSchema.extend({ ...base, event: z.literal("previewed") }).strict(),
  z.object({ ...base, event: z.literal("managed"), state: z.enum(["running", "reaping", "stopped"]) }).strict(),
  z.object({ ...base, event: z.literal("done") }).strict(),
  z.object({ ...base, event: z.literal("failed"), code: z.string().regex(/^[a-z_]{1,64}$/),
    errorClass: z.string().max(80).optional(), nativeError: count.nullable().optional() }).strict(),
]);
export type VideoTaskStatus = typeof videoTaskStatuses[number];
export type VideoMedia = z.infer<typeof videoMediaSchema>;
export type VideoChoice = { id: string; formatIds: string[]; label: string; size: number | null; requireAudio: boolean };
export type ResolvedVideo = { resolveId: string; sourceUrl: string; bvid: string; part: number; cid: string; title: string; duration: number | null;
  cover: string | null; pages: { part: number; title: string; duration: number | null }[]; choices: VideoChoice[] };
export type VideoTaskSummary = {
  id: string; projectId: string; sourceUrl: string; bvid: string; part: number;
  title: string; formatIds: string[]; status: VideoTaskStatus;
  progress: { downloadedBytes: number | null; totalBytes: number | null; speed: number | null };
  previewStatus: typeof previewStatuses[number]; recoveryMode: string | null;
  retryCount: number; assetId: string | null; media: VideoMedia | null;
  errorCode: string | null; errorMessage: string | null; createdAt: string; updatedAt: string;
  originalUrl: string | null; previewUrl: string | null; coverUrl: string | null;
};
