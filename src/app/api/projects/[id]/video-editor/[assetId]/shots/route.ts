import { cancelShotAnalysis, correctShotCuts, shotAnalysisStatus, startShotAnalysis } from "@/features/video-editor/server/shot-analysis";

type Context = RouteContext<"/api/projects/[id]/video-editor/[assetId]/shots">;

export async function GET(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const state = await shotAnalysisStatus(id, assetId);
  return Response.json(state, { status: state.status === "missing" ? 404 : 200 });
}

export async function POST(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const state = await startShotAnalysis(id, assetId);
  return Response.json(state, { status: state.status === "missing" ? 404 : 202 });
}

export async function DELETE(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const state = await cancelShotAnalysis(id, assetId);
  return Response.json(state, { status: state.status === "missing" ? 404 : 202 });
}

export async function PATCH(request: Request, context: Context) {
  const { id, assetId } = await context.params;
  let body: { cuts?: unknown; expectedRevision?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "无效的切点数据" }, { status: 400 }); }
  const result = await correctShotCuts(id, assetId, body.cuts, body.expectedRevision);
  if (result.status === "missing") return Response.json({ error: "原视频不存在" }, { status: 404 });
  if (result.status === "conflict") return Response.json({ error: result.reason }, { status: 409 });
  return Response.json(result.state);
}
