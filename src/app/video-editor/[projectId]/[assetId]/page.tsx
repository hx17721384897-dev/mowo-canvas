import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { listProjectAssets } from "@/features/assets/server/asset-catalog";
import { VideoEditorWorkspace } from "@/features/video-editor/video-editor-workspace";

export const instant = false;

export default async function VideoEditorPage({ params, searchParams }: PageProps<"/video-editor/[projectId]/[assetId]">) {
  await connection();
  const { projectId, assetId } = await params;
  const assets = await listProjectAssets(projectId);
  const asset = assets.find((item) => item.id === assetId && item.type === "video" && !item.clip);
  if (!asset) notFound();
  const query = await searchParams;
  const clipId = typeof query.clip === "string" ? query.clip : null;
  const initialClip = clipId ? assets.find((item) => item.id === clipId && item.clip?.sourceAssetId === assetId) : undefined;
  if (!asset.previewUrl) return <main><p>当前视频没有可用预览。</p><Link href={`/canvas/${projectId}`}>返回画布</Link></main>;
  return <VideoEditorWorkspace key={`${projectId}:${assetId}`} asset={asset} projectId={projectId} initialClip={initialClip} />;
}
