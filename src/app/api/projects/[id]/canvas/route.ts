import { getCanvasDocument, saveCanvasDocument } from "@/features/projects/server/project-service";
import type { CanvasDocumentState } from "@/features/projects/types";

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

function isCanvasDocument(value: unknown): value is CanvasDocumentState {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<CanvasDocumentState>;
  const viewport = document.viewport as Partial<CanvasDocumentState["viewport"]> | undefined;
  return document.schemaVersion === 1
    && Array.isArray(document.nodes)
    && Array.isArray(document.edges)
    && Boolean(viewport)
    && Number.isFinite(viewport?.x)
    && Number.isFinite(viewport?.y)
    && Number.isFinite(viewport?.zoom);
}

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/canvas">) {
  const { id } = await context.params;
  return Response.json({ document: await getCanvasDocument(id) });
}

export async function PUT(request: Request, context: RouteContext<"/api/projects/[id]/canvas">) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_DOCUMENT_BYTES) return Response.json({ error: "画布内容超过 5MB 限制" }, { status: 413 });
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) return Response.json({ error: "画布内容超过 5MB 限制" }, { status: 413 });
    const document = JSON.parse(text) as unknown;
    if (!isCanvasDocument(document)) return Response.json({ error: "画布文档格式无效" }, { status: 400 });
    const { id } = await context.params;
    return Response.json(await saveCanvasDocument(id, document));
  } catch (error) {
    console.error("保存画布失败", error);
    return Response.json({ error: "保存画布失败" }, { status: 500 });
  }
}
