import { createProject, listProjects } from "@/features/projects/server/project-service";

export async function GET(request: Request) {
  const exclude = new URL(request.url).searchParams.get("exclude") ?? undefined;
  return Response.json({ projects: await listProjects(exclude) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "未命名画布";
    return Response.json({ project: await createProject(name) }, { status: 201 });
  } catch (error) {
    console.error("创建画布项目失败", error);
    return Response.json({ error: "无法创建画布项目" }, { status: 500 });
  }
}
