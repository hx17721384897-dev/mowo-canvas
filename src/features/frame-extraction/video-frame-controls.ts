import { z } from "zod";
import { videoFrameSettingsSchema, type VideoFrameSettings } from "./video-frame-result.ts";
import type { VideoFrameJob, VideoFrameJobInput } from "./video-frame-jobs.ts";

export const defaultVideoFrameSettings: VideoFrameSettings = { restore: false, every: 1, keep: 1 };
export const videoFrameConfigSchema = z.object({
  settings: videoFrameSettingsSchema,
  overrides: z.record(z.string().max(120), videoFrameSettingsSchema),
  excluded: z.array(z.string().max(120)).max(500),
}).strict();
export type VideoFrameConfig = z.infer<typeof videoFrameConfigSchema>;
export const emptyVideoFrameConfig: VideoFrameConfig = { settings: defaultVideoFrameSettings, overrides: {}, excluded: [] };
export type VideoFrameConnectedInput = {
  assetId: string; name: string; clip?: { sourceAssetId: string };
};
export const videoFrameJobActive = (job: VideoFrameJob) => ["queued", "running", "cancelling"].includes(job.status);
export const videoFrameSettingsKey = (settings: VideoFrameSettings) => JSON.stringify(videoFrameSettingsSchema.parse(settings));

export function matchingVideoAnalysis(jobs: VideoFrameJob[], assetId: string, settings: VideoFrameSettings): VideoFrameJobInput | undefined {
  const key = videoFrameSettingsKey(settings);
  return [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((job) => job.mode === "analyze")
    .flatMap((job) => job.inputs).find((input) => input.assetId === assetId && videoFrameSettingsKey(input.settings) === key);
}

export function videoFrameCanExtract(input: VideoFrameJobInput | undefined) {
  return input?.status === "analyzed" && Boolean(input.analysis) && !input.analysis?.issue;
}

const errors: Record<string, string> = {
  INVALID_DURATION: "无法读取有效时长，请检查视频或重新导入。",
  INVALID_SIZE: "无法读取有效文件大小，请检查视频或重新导入。",
  OUTPUT_LIMIT: "预计超过 150 帧，请增大抽帧间隔或先截短片段。",
  TARGET_FPS_REQUIRED: "节奏判断不充分，请手动设置还原帧率。",
  TARGET_FPS_TOO_LOW: "还原帧率过低，无法保留所有不同画面，请提高帧率。",
  DURATION_LIMIT: "处理范围超过 60 秒，请先截取片段。",
  SIZE_LIMIT: "处理素材超过 200 MiB，请先截取较小片段。",
  PIXEL_LIMIT: "分辨率或总像素处理量过大，请先截短片段。",
  SOURCE_FRAME_LIMIT: "需要读取的源帧过多，请先截短片段。",
  OUTPUT_SIZE_LIMIT: "帧图片总量过大，请增大抽帧间隔或截短片段。",
  DISK_SPACE: "磁盘剩余空间不足，请清理空间后重试。",
  VIDEO_UNAVAILABLE: "视频不存在或不属于当前项目，请重新连接。",
  INTERRUPTED: "上次处理被中断，可重试未完成的素材。",
  CANCELLED: "已取消。",
  TIMEOUT: "处理超时，请截短片段后重试。",
  RUNTIME_PACKAGES_REQUIRED: "缺少视频处理运行依赖，请检查本机媒体环境。",
  INDEX_FAILED: "源帧索引建立失败，请检查视频与媒体运行环境后重试。",
  STALE_INDEX: "源帧索引已失效，请重新检测。",
  SOURCE_CHANGED: "原片发生变化，请重新检测。",
  NODE_BUSY: "此节点仍有任务，请等待或取消后再操作。",
  REQUEST_CONFLICT: "请求编号对应的参数不同，请恢复原请求后再重新操作。",
};
export const videoFrameErrorText = (code: string) => errors[code] ?? `处理失败（${code}），可重新检测或重试。`;
