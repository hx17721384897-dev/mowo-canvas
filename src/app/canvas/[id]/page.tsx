import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCanvasDocument, openProject } from "@/features/projects/server/project-service";
import { CanvasWorkspace } from "../../components/canvas-workspace";

export const instant = false;

export default async function CanvasPage({ params }: PageProps<"/canvas/[id]">) {
  await connection();
  const { id } = await params;
  if (id === "new") redirect("/");
  const project = await openProject(id);
  const initialDocument = await getCanvasDocument(id);
  return <CanvasWorkspace initialDocument={initialDocument} projectId={id} title={project.name} />;
}
