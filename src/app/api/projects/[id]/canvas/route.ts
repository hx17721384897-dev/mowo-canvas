import { getCanvasDocument, saveCanvasDocument } from "@/features/projects/server/project-service";
import { CanvasDocumentError, MAX_CANVAS_BYTES, validateCanvasDocument } from "@/features/projects/canvas-document";

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/canvas">) {
  const { id } = await context.params;
  try {
    return Response.json({ document: await getCanvasDocument(id) });
  } catch (error) {
    if (error instanceof CanvasDocumentError) {
      return Response.json({ code: error.code, field: error.field, error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function PUT(request: Request, context: RouteContext<"/api/projects/[id]/canvas">) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_CANVAS_BYTES) return Response.json({ error: "画布内容超过 5MB 限制" }, { status: 413 });
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_CANVAS_BYTES) return Response.json({ error: "画布内容超过 5MB 限制" }, { status: 413 });
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      return Response.json({ code: "INVALID_JSON", error: "请求不是有效的 JSON" }, { status: 400 });
    }
    validateCanvasDocument(document);
    const { id } = await context.params;
    return Response.json(await saveCanvasDocument(id, document));
  } catch (error) {
    if (error instanceof CanvasDocumentError) {
      return Response.json({ code: error.code, field: error.field, error: error.message }, { status: error.code === "CANVAS_LIMIT" ? 413 : 400 });
    }
    console.error("保存画布失败", error);
    return Response.json({ error: "保存画布失败" }, { status: 500 });
  }
}
