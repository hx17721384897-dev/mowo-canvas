import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CanvasDocumentError } from "@/features/projects/canvas-document";
import { connection } from "next/server";
import { getCanvasDocument, openProject } from "@/features/projects/server/project-service";
import { CanvasWorkspace } from "../../components/canvas-workspace";

export const instant = false;

export default async function CanvasPage({ params }: PageProps<"/canvas/[id]">) {
  await connection();
  const { id } = await params;
  if (id === "new") redirect("/");
  const project = await openProject(id);
  if (!project) notFound();
  let initialDocument;
  try {
    initialDocument = await getCanvasDocument(id);
  } catch (error) {
    if (!(error instanceof CanvasDocumentError)) throw error;
    return <main style={{ padding: 32 }}>
      <h1>无法安全打开画布</h1>
      <p>{error.field}：{error.message}。原始记录已保留。</p>
      <Link href="/">返回首页</Link>
    </main>;
  }
  return <CanvasWorkspace initialDocument={initialDocument} projectId={id} title={project.name} />;
}
