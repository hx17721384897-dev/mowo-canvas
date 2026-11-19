/** Shared video preflight rules. GIF/APNG extraction keeps its existing limits. */
export const VIDEO_FRAME_LIMITS = { maxSeconds: 60, maxBytes: 200 * 1024 * 1024, maxOutputFrames: 150 } as const;

export type FrameSampling = { every: number; keep: number };
export type VideoFrameIssue = "INVALID_DURATION" | "DURATION_LIMIT" | "INVALID_SIZE" | "SIZE_LIMIT" | "EMPTY_SEQUENCE" | "OUTPUT_LIMIT";

export function validateVideoFrameRange(durationSeconds: number, bytes: number | null): VideoFrameIssue[] {
  const issues: VideoFrameIssue[] = [];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) issues.push("INVALID_DURATION");
  else if (durationSeconds > VIDEO_FRAME_LIMITS.maxSeconds) issues.push("DURATION_LIMIT");
  // null means a referenced clip still requires bounded preparation to measure bytes.
  if (bytes !== null) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) issues.push("INVALID_SIZE");
    else if (bytes > VIDEO_FRAME_LIMITS.maxBytes) issues.push("SIZE_LIMIT");
  }
  return issues;
}

function validateSampling(frameCount: number, sampling: FrameSampling) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new Error("无效帧数");
  if (!Number.isSafeInteger(sampling.every) || !Number.isSafeInteger(sampling.keep)
    || sampling.every < 1 || sampling.keep < 1 || sampling.keep > sampling.every) {
    throw new Error("抽帧设置必须满足 1 ≤ 保留帧数 ≤ 间隔帧数");
  }
}

export function sampledFrameCount(frameCount: number, sampling: FrameSampling): number {
  validateSampling(frameCount, sampling);
  return Math.floor(frameCount / sampling.every) * sampling.keep + Math.min(frameCount % sampling.every, sampling.keep);
}

export function videoOutputIssue(count: number): VideoFrameIssue | null {
  if (!Number.isSafeInteger(count) || count < 1) return "EMPTY_SEQUENCE";
  return count > VIDEO_FRAME_LIMITS.maxOutputFrames ? "OUTPUT_LIMIT" : null;
}

/** Starts may be actual source PTS or restored timeline positions, in seconds. */
export function planSampledFrames(starts: readonly number[], endSeconds: number, sampling: FrameSampling) {
  const count = sampledFrameCount(starts.length, sampling);
  const issue = videoOutputIssue(count);
  if (issue) throw new Error(issue);
  if (!Number.isFinite(endSeconds) || starts.some((time, index) => !Number.isFinite(time)
    || time < 0 || (index > 0 && time <= starts[index - 1]) || time >= endSeconds)) {
    throw new Error("无效帧时间序列");
  }
  const positions: number[] = [];
  for (let base = 0; base < starts.length; base += sampling.every) {
    for (let offset = 0; offset < Math.min(sampling.keep, starts.length - base); offset += 1) positions.push(base + offset);
  }
  return positions.map((inputPosition, index) => ({
    inputPosition,
    startSeconds: starts[inputPosition],
    durationSeconds: (index + 1 < positions.length ? starts[positions[index + 1]] : endSeconds) - starts[inputPosition],
  }));
}
