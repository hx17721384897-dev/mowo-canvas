import { createProject, listProjects } from "@/features/projects/server/project-service";
import { deleteProjects, ProjectTasksPendingError } from "@/features/projects/server/delete-projects";

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const ids: unknown = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id.trim())) {
    return Response.json({ error: "请选择要删除的画布" }, { status: 400 });
  }
  try { return Response.json({ deleted: await deleteProjects([...new Set<string>(ids)]) }); }
  catch (error) { if (error instanceof ProjectTasksPendingError) return Response.json({ error: error.message }, { status: 409 }); throw error; }
}

export async function GET(request: Request) {
  const exclude = new URL(request.url).searchParams.get("exclude") ?? undefined;
  return Response.json({ projects: await listProjects(exclude) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : undefined;
    return Response.json({ project: await createProject(name) }, { status: 201 });
  } catch (error) {
    console.error("创建画布项目失败", error);
    return Response.json({ error: "无法创建画布项目" }, { status: 500 });
  }
}
