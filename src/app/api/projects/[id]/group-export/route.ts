import { cleanExportName, prepareGroupExport, streamGroupZip, type GroupExportRequest } from "@/features/assets/server/group-export";

export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/group-export">) {
  const { id } = await context.params;
  try {
    if (Number(request.headers.get("content-length")) > 1_000_000) return Response.json({ error: "导出清单过大" }, { status: 413 });
    const body = await request.json() as { name?: unknown; entries?: GroupExportRequest[] };
    if (typeof body.name !== "string" || body.name.length > 120) return Response.json({ error: "压缩包名称无效" }, { status: 400 });
    const files = await prepareGroupExport(id, body.entries ?? []);
    const filename = `${cleanExportName(body.name.replace(/\.zip$/i, ""))}.zip`;
    return new Response(streamGroupZip(files), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="group.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    const message = error instanceof Error && /^(请选择|导出清单|组内|压缩包)/.test(error.message) ? error.message : "组导出失败";
    return Response.json({ error: message }, { status: message.startsWith("压缩包超过") ? 413 : 400 });
  }
}
