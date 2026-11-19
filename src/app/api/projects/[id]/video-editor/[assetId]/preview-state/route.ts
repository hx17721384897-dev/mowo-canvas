import { ensurePreview, previewStatus } from "@/features/video-editor/server/preview";

type Context = RouteContext<"/api/projects/[id]/video-editor/[assetId]/preview-state">;
export async function GET(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const state = await previewStatus(id, assetId);
  return Response.json(state, { status: state.status === "missing" ? 404 : 200 });
}

export async function POST(_request: Request, context: Context) {
  const { id, assetId } = await context.params;
  const state = await ensurePreview(id, assetId);
  return Response.json(state, { status: state.status === "missing" ? 404 : 202 });
}
