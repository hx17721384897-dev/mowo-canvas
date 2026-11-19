export type CuttingClip = { id: string; sourceAssetId: string; inFrame: number; outFrame: number };

export function validCuttingClips(value: unknown, sourceAssetId: string, frameCount: number): value is CuttingClip[] {
  if (!Array.isArray(value) || value.length > 1000 || !Number.isSafeInteger(frameCount) || frameCount < 1) return false;
  const ids = new Set<string>();
  return value.every((clip) => {
    if (!clip || typeof clip !== "object") return false;
    const item = clip as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || item.id.length > 100 || ids.has(item.id) ||
      item.sourceAssetId !== sourceAssetId || !Number.isSafeInteger(item.inFrame) ||
      !Number.isSafeInteger(item.outFrame) || (item.inFrame as number) < 0 ||
      (item.outFrame as number) <= (item.inFrame as number) || (item.outFrame as number) > frameCount) return false;
    ids.add(item.id);
    return true;
  });
}

export function splitCuttingClip(clips: CuttingClip[], id: string, frame: number, newId: string) {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0 || frame <= clips[index].inFrame || frame >= clips[index].outFrame) return clips;
  const first = { ...clips[index], outFrame: frame };
  const second = { ...clips[index], id: newId, inFrame: frame };
  return [...clips.slice(0, index), first, second, ...clips.slice(index + 1)];
}

export function trimCuttingClip(clips: CuttingClip[], id: string, edge: "in" | "out", frame: number) {
  return clips.map((clip) => {
    if (clip.id !== id) return clip;
    return edge === "in" ? { ...clip, inFrame: Math.max(0, Math.min(clip.outFrame - 1, frame)) }
      : { ...clip, outFrame: Math.max(clip.inFrame + 1, frame) };
  });
}

export function removeCuttingClip(clips: CuttingClip[], id: string) {
  return clips.filter((clip) => clip.id !== id);
}

export function moveCuttingClip(clips: CuttingClip[], id: string, insertion: number) {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return clips;
  const remaining = clips.filter((clip) => clip.id !== id);
  const target = Math.max(0, Math.min(remaining.length, insertion));
  return [...remaining.slice(0, target), clips[index], ...remaining.slice(target)];
}

export function clipSeconds(clip: CuttingClip, sourceTimes: number[], sourceDuration: number) {
  const start = sourceTimes[clip.inFrame];
  const end = clip.outFrame === sourceTimes.length ? sourceDuration : sourceTimes[clip.outFrame];
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export function cuttingDuration(clips: CuttingClip[], sourceTimes: number[], sourceDuration: number) {
  return clips.reduce((total, clip) => total + clipSeconds(clip, sourceTimes, sourceDuration), 0);
}

function frameAt(sourceTimes: number[], seconds: number) {
  let low = 0, high = sourceTimes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sourceTimes[middle] <= seconds) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function locateCuttingTime(clips: CuttingClip[], sourceTimes: number[], sourceDuration: number, time: number) {
  if (!clips.length || !sourceTimes.length || !Number.isFinite(time)) return null;
  const total = cuttingDuration(clips, sourceTimes, sourceDuration);
  if (total <= 0) return null;
  const target = Math.max(0, Math.min(time, total));
  let offset = 0;
  for (const [index, clip] of clips.entries()) {
    const length = clipSeconds(clip, sourceTimes, sourceDuration);
    if (length <= 0) continue;
    if (target < offset + length || index === clips.length - 1) {
      const lastTime = sourceTimes[clip.outFrame - 1];
      const sourceSeconds = Math.min(lastTime, sourceTimes[clip.inFrame] + Math.max(0, target - offset));
      return { clipId: clip.id, sourceFrame: Math.max(clip.inFrame, Math.min(clip.outFrame - 1, frameAt(sourceTimes, sourceSeconds))),
        sourceSeconds, cuttingSeconds: target };
    }
    offset += length;
  }
  return null;
}

export function cuttingTimeForSource(clips: CuttingClip[], sourceTimes: number[], sourceDuration: number,
  clipId: string, sourceSeconds: number) {
  let offset = 0;
  for (const clip of clips) {
    const length = clipSeconds(clip, sourceTimes, sourceDuration);
    if (clip.id === clipId) {
      const start = sourceTimes[clip.inFrame];
      return Number.isFinite(start) && sourceSeconds >= start && sourceSeconds < start + length
        ? offset + sourceSeconds - start : null;
    }
    offset += length;
  }
  return null;
}
