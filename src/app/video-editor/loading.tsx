import { LoadingProgress } from "@/components/loading-progress";

export default function LoadingVideoEditor() {
  return <LoadingProgress title="正在打开视频观察页" description="正在读取素材信息并准备工作区…" variant="screen" />;
}
