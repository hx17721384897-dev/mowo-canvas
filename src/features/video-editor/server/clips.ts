import "server-only";

import { basename, extname } from "node:path";
import { and, eq, isNull, max } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { listProjectAssets } from "@/features/assets/server/asset-catalog";
import { assets, projectAssets, videoClipDrafts, videoClips } from "@/features/assets/server/schema";
import { clipBoundaries } from "./frame-index";

export class ClipError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function saveVideoClip(projectId: string, sourceAssetId: string, input: {
  intentId: string; startFrame: number; endFrame: number; name?: string;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.intentId))
    throw new ClipError("无效片段请求");
  const database = await getAssetDatabase();
  const earlier = database.select().from(videoClips).where(eq(videoClips.id, input.intentId)).get();
  if (earlier) {
    if (earlier.projectId !== projectId || earlier.sourceAssetId !== sourceAssetId
      || earlier.startFrame !== input.startFrame || earlier.endFrame !== input.endFrame)
      throw new ClipError("片段请求与已有记录冲突", 409);
    const clip = (await listProjectAssets(projectId)).find((item) => item.id === earlier.id);
    if (!clip) throw new ClipError("已保存片段暂不可用", 409);
    return clip;
  }
  const boundaries = await clipBoundaries(projectId, sourceAssetId, input.startFrame, input.endFrame);
  if (!boundaries) throw new ClipError("帧索引未就绪或片段边界无效", 409);
  const clipId = database.transaction((transaction) => {
    const source = transaction.select({ asset: assets }).from(projectAssets)
      .innerJoin(assets, eq(projectAssets.assetId, assets.id))
      .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, sourceAssetId), isNull(assets.deletedAt))).get()?.asset;
    if (!source || source.type !== "video" || source.sourceType === "video-clip" || !source.relativePath)
      throw new ClipError("原视频不属于此项目", 404);
    const previous = transaction.select().from(videoClips).where(eq(videoClips.id, input.intentId)).get();
    if (previous) {
      if (previous.projectId !== projectId || previous.sourceAssetId !== sourceAssetId
        || previous.startFrame !== input.startFrame || previous.endFrame !== input.endFrame)
        throw new ClipError("片段请求与已有记录冲突", 409);
      return previous.id;
    }
    const next = (transaction.select({ highest: max(videoClips.sequence) }).from(videoClips)
      .where(and(eq(videoClips.projectId, projectId), eq(videoClips.sourceAssetId, sourceAssetId))).get()?.highest ?? 0) + 1;
    const requestedName = input.name?.trim();
    if (requestedName && requestedName.length > 100) throw new ClipError("片段名称过长");
    const name = requestedName || `${basename(source.originalName, extname(source.originalName))} · 片段 ${String(next).padStart(2, "0")}`;
    const now = new Date();
    transaction.insert(assets).values({ id: input.intentId, type: "video", originalName: name,
      relativePath: source.relativePath, mimeType: source.mimeType, size: null,
      width: source.width, height: source.height, duration: Math.round(boundaries.endSeconds - boundaries.startSeconds),
      sourceType: "video-clip", sourceUrl: `asset:${sourceAssetId}`, createdAt: now }).run();
    transaction.insert(videoClips).values({ id: input.intentId, projectId, sourceAssetId, sequence: next,
      startFrame: input.startFrame, endFrame: input.endFrame, startPts: boundaries.startPts, endPts: boundaries.endPts,
      timeBaseNumerator: boundaries.timeBaseNumerator, timeBaseDenominator: boundaries.timeBaseDenominator,
      createdAt: now }).run();
    transaction.insert(projectAssets).values({ projectId, assetId: input.intentId, addedAt: now }).run();
    transaction.delete(videoClipDrafts).where(and(eq(videoClipDrafts.projectId, projectId),
      eq(videoClipDrafts.sourceAssetId, sourceAssetId))).run();
    return input.intentId;
  });
  const asset = (await listProjectAssets(projectId)).find((item) => item.id === clipId);
  if (!asset) throw new ClipError("片段已保存，但暂时无法读取素材卡", 500);
  return asset;
}
