import { z } from "zod";
import { videoFrameSettingsSchema, type VideoFrameResult, type VideoFrameSettings } from "./video-frame-result.ts";

const id = z.string().min(1).max(120);
export const confirmVideoFrameJobSchema = z.object({
  action: z.literal("confirm"),
  inputs: z.array(z.object({ assetId: id, settings: videoFrameSettingsSchema }).strict()).min(1).max(50),
}).strict().refine(body => new Set(body.inputs.map(input => input.assetId)).size === body.inputs.length);
export const createVideoFrameJobSchema = z.object({
  requestId: z.uuid(), nodeId: id, mode: z.enum(["analyze", "extract"]),
  settings: videoFrameSettingsSchema.default({ restore: false, every: 1, keep: 1 }),
  inputs: z.array(z.object({ assetId: id, settings: videoFrameSettingsSchema.optional() }).strict()).min(1).max(50),
}).strict().refine((body) => new Set(body.inputs.map((input) => input.assetId)).size === body.inputs.length,
  { message: "同一视频不能重复加入一个批次" });
export type CreateVideoFrameJob = z.infer<typeof createVideoFrameJobSchema>;
export type VideoFrameAnalysis = Pick<VideoFrameResult, "width" | "height" | "durationMs" | "preparedBytes"
  | "estimatedFrameCount" | "recommendation" | "targetFps" | "timingErrorMs" | "issue"> & { sourceFrameCount?: number; sourceFps?: number; sourceStartFrame?: number };
export type VideoFrameJobInput = {
  assetId: string; name: string; settings: VideoFrameSettings;
  status: "pending" | "running" | "analyzed" | "ready" | "failed" | "cancelled";
  stage?: "indexing" | "preparing" | "analyzing" | "extracting";
  completed?: number; total?: number; analysis?: VideoFrameAnalysis; errorCode?: string; sourceId?: string;
};
export type VideoFrameJob = {
  id: string; projectId: string; nodeId: string; requestId: string; mode: "analyze" | "extract";
  status: "queued" | "running" | "cancelling" | "ready" | "partial" | "failed" | "cancelled";
  inputs: VideoFrameJobInput[]; resultTaskId: string | null; errorCode: string | null; updatedAt: string;
};

export class VideoFrameJobError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
