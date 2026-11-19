import { createSourceFolder, listSourceFolders } from "@/features/assets/server/source-folders";

export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/asset-folders">) {
  const { id } = await context.params;
  return Response.json(await listSourceFolders(id));
}

export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/asset-folders">) {
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string"
    || !("sourceCategory" in body) || !["download", "import"].includes(String(body.sourceCategory)))
    return Response.json({ error: "文件夹参数无效" }, { status: 400 });
  try { return Response.json(await createSourceFolder(id, body.name, body.sourceCategory as "download" | "import"), { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 }); }
}
