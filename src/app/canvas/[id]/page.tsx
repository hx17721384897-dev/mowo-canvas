import { CanvasWorkspace } from "../../components/canvas-workspace";

export const instant = false;

const projectTitles: Record<string, string> = {
  "emoji-workflow": "表情包工作流",
  storyboard: "动画分镜整理",
  "brand-assets": "品牌素材处理",
  "video-notes": "视频灵感与脚本",
  "product-research": "产品调研画布",
  "weekly-plan": "本周工作规划",
  new: "未命名画布",
};

export default async function CanvasPage({ params }: PageProps<"/canvas/[id]">) {
  const { id } = await params;
  return <CanvasWorkspace title={projectTitles[id] ?? "画布项目"} />;
}
