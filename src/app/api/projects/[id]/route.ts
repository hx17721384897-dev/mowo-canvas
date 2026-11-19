import { renameProject } from "@/features/projects/server/project-service";
import { deleteProjects, ProjectTasksPendingError } from "@/features/projects/server/delete-projects";

export async function PATCH(request: Request, context: RouteContext<"/api/projects/[id]">) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return Response.json({ error: "请输入 1–80 个字符的画布名称" }, { status: 400 });
  const project = await renameProject(id, name);
  return project ? Response.json({ project }) : Response.json({ error: "画布不存在" }, { status: 404 });
}

export async function DELETE(_request: Request, context: RouteContext<"/api/projects/[id]">) {
  const { id } = await context.params;
  try { await deleteProjects([id]); }
  catch (error) { if (error instanceof ProjectTasksPendingError) return Response.json({ error: error.message }, { status: 409 }); throw error; }
  return new Response(null, { status: 204 });
}
