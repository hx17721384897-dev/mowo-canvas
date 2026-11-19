import { and, eq, isNull } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { assets, projectAssets, videoCuttingProjects } from "@/features/assets/server/schema";
import { validCuttingClips } from "@/features/video-editor/cutting-model";
import { frameIndexStatus } from "@/features/video-editor/server/frame-index";

type Context = RouteContext<"/api/projects/[id]/video-editor/[assetId]/cutting-project">;

async function access(context: Context) {
  const { id, assetId } = await context.params;
  const database = await getAssetDatabase();
  const asset = database.select({ asset: assets }).from(projectAssets).innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .where(and(eq(projectAssets.projectId, id), eq(projectAssets.assetId, assetId), isNull(assets.deletedAt))).get()?.asset;
  return asset?.type === "video" && asset.sourceType !== "video-clip" && asset.contentHash
    ? { database, id, assetId, hash: asset.contentHash } : null;
}

export async function GET(_request: Request, context: Context) {
  const scope = await access(context);
  if (!scope) return Response.json({ error: "原视频不属于此项目" }, { status: 404 });
  const row = scope.database.select().from(videoCuttingProjects).where(and(eq(videoCuttingProjects.projectId, scope.id),
    eq(videoCuttingProjects.sourceAssetId, scope.assetId))).get();
  if (!row) return Response.json({ clips: null, revision: 0 });
  if (row.sourceHash !== scope.hash) return Response.json({ error: "原视频内容已变化，请重新建立剪辑工程" }, { status: 409 });
  let clips: unknown;
  try { clips = JSON.parse(row.clipsJson); }
  catch { return Response.json({ error: "剪辑工程无法读取" }, { status: 409 }); }
  return Response.json({ clips, revision: row.revision, updatedAt: row.updatedAt.getTime() });
}

export async function PUT(request: Request, context: Context) {
  const scope = await access(context);
  if (!scope) return Response.json({ error: "原视频不属于此项目" }, { status: 404 });
  if (Number(request.headers.get("content-length")) > 256 * 1024)
    return Response.json({ error: "剪辑工程过大" }, { status: 413 });
  const input = await request.json().catch(() => null) as { clips?: unknown; expectedRevision?: unknown } | null;
  const index = await frameIndexStatus(scope.id, scope.assetId);
  if (index.status !== "ready") return Response.json({ error: "源帧索引尚未就绪" }, { status: 409 });
  if (!input || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0 ||
      !validCuttingClips(input.clips, scope.assetId, index.metadata.frameCount))
    return Response.json({ error: "剪辑片段范围无效" }, { status: 400 });
  const json = JSON.stringify(input.clips);
  if (json.length > 256 * 1024) return Response.json({ error: "剪辑工程过大" }, { status: 413 });
  const now = new Date();
  const result = scope.database.transaction((database) => {
    const where = and(eq(videoCuttingProjects.projectId, scope.id), eq(videoCuttingProjects.sourceAssetId, scope.assetId));
    const existing = database.select().from(videoCuttingProjects).where(where).get();
    if ((existing?.revision ?? 0) !== input.expectedRevision || (existing && existing.sourceHash !== scope.hash)) return null;
    const revision = (existing?.revision ?? 0) + 1;
    if (existing) database.update(videoCuttingProjects).set({ clipsJson: json, revision, updatedAt: now }).where(where).run();
    else database.insert(videoCuttingProjects).values({ projectId: scope.id, sourceAssetId: scope.assetId,
      sourceHash: scope.hash, clipsJson: json, revision, createdAt: now, updatedAt: now }).run();
    return { clips: input.clips, revision, updatedAt: now.getTime() };
  });
  if (!result) return Response.json({ error: "剪辑工程已在其他页面修改，请重新打开" }, { status: 409 });
  return Response.json(result);
}
