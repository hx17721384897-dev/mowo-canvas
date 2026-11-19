import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { assetCollectionItems, assetCollections, assets, projectAssets } from "@/features/assets/server/schema";

import { reviewFrameInputs } from "@/features/frame-extraction/server/frame-extraction-service";

type FrameReference = { assetId: string; durationMs: number };

function isFrameReference(value: unknown): value is FrameReference {
  if (!value || typeof value !== "object") return false;
  const { assetId, durationMs } = value as Partial<FrameReference>;
  return typeof assetId === "string" && assetId.length > 0 && assetId.length <= 128
    && typeof durationMs === "number" && Number.isInteger(durationMs) && durationMs >= 1 && durationMs <= 3600000;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { projectId?: unknown; groupId?: unknown; name?: unknown; frames?: unknown } | null;
  if (!body || typeof body.projectId !== "string" || typeof body.groupId !== "string"
    || typeof body.name !== "string" || !body.name.trim() || body.name.length > 300
    || !Array.isArray(body.frames) || !body.frames.length || body.frames.length > 1000 || !body.frames.every(isFrameReference)) {
    return Response.json({ error: "序列参数无效" }, { status: 400 });
  }

  const { projectId, groupId, name, frames } = body;
  const assetIds = [...new Set(frames.map((frame) => frame.assetId))];
  const key = createHash("sha256").update(JSON.stringify([projectId, groupId, name, frames.map(({ assetId, durationMs }) => [assetId, durationMs])])).digest("hex");
  const collectionId = `ordered-${key}`;
  try {
    for (let offset = 0; offset < assetIds.length; offset += 500) {
      const items = await reviewFrameInputs(projectId, assetIds.slice(offset, offset + 500));
      if (items.some((item) => item.status !== "static")) {
        return Response.json({ error: "序列只接受可读取的静态图片，请先拆帧再加入有序组" }, { status: 400 });
      }
    }
    const database = await getAssetDatabase();
    const saved = database.transaction((tx) => {
      const found = tx.select({ id: assets.id }).from(assets)
        .innerJoin(projectAssets, eq(assets.id, projectAssets.assetId))
        .where(and(eq(projectAssets.projectId, projectId), eq(assets.type, "image"), isNull(assets.deletedAt),
          isNotNull(assets.relativePath), inArray(assets.id, assetIds))).all();
      if (found.length !== assetIds.length) return false;
      if (tx.select({ id: assetCollections.id }).from(assetCollections).where(eq(assetCollections.id, collectionId)).get()) return true;
      tx.insert(assetCollections).values({ id: collectionId, projectId, name, kind: "frame-sequence", sourceType: "ordered-group", createdAt: new Date() }).run();
      let timelineStartMs = 0;
      for (const [position, frame] of frames.entries()) {
        tx.insert(assetCollectionItems).values({ id: randomUUID(), collectionId, assetId: frame.assetId, position,
          sourcePosition: position, timelineStartMs, durationMs: frame.durationMs }).run();
        timelineStartMs += frame.durationMs;
      }
      return true;
    });
    return saved ? Response.json({ collectionId }) : Response.json({ error: "部分图片不在当前项目资产库中" }, { status: 400 });
  } catch (error) {
    console.error("Unable to save ordered frame sequence", error);
    return Response.json({ error: "无法保存序列资产" }, { status: 500 });
  }
}
