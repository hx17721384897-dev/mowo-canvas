import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { assets, projectAssets, videoClipDrafts } from "@/features/assets/server/schema";

type Context = RouteContext<"/api/projects/[id]/video-editor/[assetId]/draft">;
async function access(context: Context) {
  const { id, assetId } = await context.params;
  const database = await getAssetDatabase();
  const source = database.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, id), eq(projectAssets.assetId, assetId), isNull(assets.deletedAt))).get()?.asset;
  return source?.type === "video" && source.sourceType !== "video-clip" ? { database, id, assetId } : null;
}

export async function GET(_request: Request, context: Context) {
  const scope = await access(context);
  if (!scope) return Response.json({ error: "原视频不属于此项目" }, { status: 404 });
  const draft = scope.database.select().from(videoClipDrafts).where(and(eq(videoClipDrafts.projectId, scope.id),
    eq(videoClipDrafts.sourceAssetId, scope.assetId))).get();
  return Response.json({ draft: draft ?? null });
}

export async function PUT(request: Request, context: Context) {
  const scope = await access(context);
  if (!scope) return Response.json({ error: "原视频不属于此项目" }, { status: 404 });
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const frame = (value: unknown) => value === null || Number.isSafeInteger(value) && (value as number) >= 0;
  const second = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (!input || !frame(input.startFrame) || !frame(input.endFrame) || !second(input.startSeconds) || !second(input.endSeconds)
    || (input.name !== null && typeof input.name !== "string") || (typeof input.name === "string" && input.name.length > 100))
    return Response.json({ error: "草稿参数无效" }, { status: 400 });
  const now = new Date();
  scope.database.insert(videoClipDrafts).values({ projectId: scope.id, sourceAssetId: scope.assetId,
    startFrame: input.startFrame as number | null, endFrame: input.endFrame as number | null,
    startSeconds: input.startSeconds as number | null, endSeconds: input.endSeconds as number | null,
    name: input.name as string | null, updatedAt: now })
    .onConflictDoUpdate({ target: [videoClipDrafts.projectId, videoClipDrafts.sourceAssetId], set: {
      startFrame: input.startFrame as number | null, endFrame: input.endFrame as number | null,
      startSeconds: input.startSeconds as number | null, endSeconds: input.endSeconds as number | null,
      name: input.name as string | null, updatedAt: now,
    } }).run();
  return Response.json({ saved: true });
}

export async function DELETE(_request: Request, context: Context) {
  const scope = await access(context);
  if (!scope) return Response.json({ error: "原视频不属于此项目" }, { status: 404 });
  scope.database.delete(videoClipDrafts).where(and(eq(videoClipDrafts.projectId, scope.id),
    eq(videoClipDrafts.sourceAssetId, scope.assetId))).run();
  return Response.json({ deleted: true });
}
