import { z } from "zod";

export const videoFrameSettingsSchema = z.object({
  restore: z.boolean().default(false),
  targetFps: z.number().finite().min(1).max(120).optional(),
  every: z.number().int().min(1).max(1_000_000).default(1),
  keep: z.number().int().min(1).max(1_000_000).default(1),
  truncate: z.boolean().optional(),
  deferOutput: z.boolean().optional(),
}).refine((value) => value.keep <= value.every, { message: "保留帧数不能超过间隔帧数" });
export type VideoFrameSettings = z.infer<typeof videoFrameSettingsSchema>;

const ordinal = z.number().int().nonnegative();
const finite = z.number().finite();
export const videoFrameResultSchema = z.object({
  algorithmVersion: z.literal(1), sourceKind: z.literal("video"),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(),
  sourceStartFrame: ordinal, sourceEndFrame: ordinal,
  sourceStartPts: z.number().int(), sourceEndPts: z.number().int(),
  timeBaseNumerator: z.number().int().positive(), timeBaseDenominator: z.number().int().positive(),
  preparedBytes: z.number().int().positive(), durationMs: finite.positive(),
  restore: z.boolean(), targetFps: finite.nullable(), every: ordinal.positive(), keep: ordinal.positive(),
  recommendation: z.object({
    status: z.enum(["disabled", "uncertain", "suggested"]), suggestedFps: finite.nullable(), reason: z.string().optional(),
  }),
  issue: z.enum(["TARGET_FPS_REQUIRED", "OUTPUT_LIMIT", "TARGET_FPS_TOO_LOW"]).nullable(),
  estimatedFrameCount: ordinal.nullable(), timingErrorMs: finite,
  holds: z.array(z.object({ start: ordinal, end: ordinal })).max(7200),
  metrics: z.array(z.object({ position: ordinal, mean: finite, blockMax: finite, changedFraction: finite, similar: z.boolean() })).max(7200),
  frames: z.array(z.object({
    position: ordinal, sourcePosition: ordinal, sourceStartFrame: ordinal, sourceEndFrame: ordinal,
    sourcePts: z.number().int(), timelineStartMs: finite.nonnegative(), durationMs: finite.positive(),
    file: z.string().regex(/^source-\d{6}\.png$/).optional(),
  })).max(150),
});
export type VideoFrameResult = z.infer<typeof videoFrameResultSchema>;
