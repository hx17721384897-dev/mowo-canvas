import type { IconName } from "@/app/components/app-icon";
import type { CanvasModuleType, CanvasPortDefinition } from "./types";

export const groupMaterialsPort: CanvasPortDefinition = { id: "group-materials", label: "组内素材", contentType: "group-materials", multiple: true };
export const stitchResultPort: CanvasPortDefinition = { id: "stitched-input", label: "拼接结果", contentType: "image-collection", multiple: false };

export function canConnectPorts(output: CanvasPortDefinition, input: CanvasPortDefinition) {
  return output.contentType === input.contentType || (output.contentType === "group-materials" && ["animated-images", "video-sources", "source-task"].includes(input.id) && (input.id !== "source-task" || input.multiple));
}

export type CanvasModuleMetadata = {
  type: CanvasModuleType;
  label: string;
  icon: IconName;
  tone: "blue" | "violet";
  width: number;
  inputs: CanvasPortDefinition[];
  outputs: CanvasPortDefinition[];
};

export const canvasModules: Record<CanvasModuleType, CanvasModuleMetadata> = {
  image: {
    type: "image",
    label: "图片",
    icon: "image",
    tone: "blue",
    width: 190,
    inputs: [
      { id: "image-input", label: "图片", contentType: "image", multiple: false },
    ],
    outputs: [
      { id: "image", label: "图片", contentType: "image", multiple: true },
    ],
  },
  text: {
    type: "text",
    label: "文本",
    icon: "text",
    tone: "blue",
    width: 300,
    inputs: [{ id: "text-input", label: "文本", contentType: "text", multiple: false }],
    outputs: [{ id: "text", label: "文本", contentType: "text", multiple: true }],
  },
  video: {
    type: "video",
    label: "视频",
    icon: "video",
    tone: "blue",
    width: 280,
    inputs: [{ id: "video-input", label: "视频", contentType: "video", multiple: false }],
    outputs: [{ id: "video", label: "视频", contentType: "video", multiple: true }],
  },
  audio: {
    type: "audio",
    label: "音频",
    icon: "audio",
    tone: "blue",
    width: 280,
    inputs: [{ id: "audio-input", label: "音频", contentType: "audio", multiple: false }],
    outputs: [{ id: "audio", label: "音频", contentType: "audio", multiple: true }],
  },
  "batch-crop": {
    type: "batch-crop",
    label: "批量裁切",
    icon: "crop",
    tone: "violet",
    width: 245,
    inputs: [
      { id: "source-images", label: "图片", contentType: "image", multiple: true },
    ],
    outputs: [
      { id: "results", label: "图片集合", contentType: "image-collection", multiple: true },
    ],
  },
  "crop-result": {
    type: "crop-result", label: "裁切结果", icon: "crop", tone: "violet", width: 660,
    inputs: [{ id: "source-image", label: "原图", contentType: "image", multiple: false },
      { id: "source-group", label: "有序组", contentType: "group-materials", multiple: false }],
    outputs: [{ id: "cropped-images", label: "图片集合", contentType: "image-collection", multiple: true }],
  },
  "frame-extraction": {
    type: "frame-extraction",
    label: "动图拆帧",
    icon: "layers",
    tone: "violet",
    width: 250,
    inputs: [{ id: "animated-images", label: "动图", contentType: "image", multiple: true }],
    outputs: [{ id: "frame-sequences", label: "序列帧集合", contentType: "image-collection", multiple: true }],
  },
  "video-frame-extraction": {
    type: "video-frame-extraction", label: "视频拆帧", icon: "layers", tone: "violet", width: 380,
    inputs: [{ id: "video-sources", label: "视频或片段", contentType: "video", multiple: true }],
    outputs: [{ id: "frame-sequences", label: "序列帧集合", contentType: "image-collection", multiple: true }],
  },
  "frame-batch": {
    type: "frame-batch",
    label: "动画帧批次",
    icon: "group",
    tone: "violet",
    width: 440,
    inputs: [{ id: "source-task", label: "拆帧结果", contentType: "image-collection", multiple: false }],
    outputs: [{ id: "sequences", label: "有序动画帧批次", contentType: "image-collection", multiple: true }],
  },
  "frame-result": {
    type: "frame-result",
    label: "动画帧编辑",
    icon: "layers",
    tone: "violet",
    width: 660,
    inputs: [{ id: "source-task", label: "有序图片组或动画帧批次", contentType: "image-collection", multiple: true }],
    outputs: [{ id: "sequences", label: "序列帧集合", contentType: "image-collection", multiple: true }],
  },
  "frame-stitch": {
    type: "frame-stitch", label: "动画帧拼接", icon: "grid", tone: "violet", width: 290,
    inputs: [{ id: "source-task", label: "动画帧序列", contentType: "image-collection", multiple: false }],
    outputs: [{ id: "stitched-images", label: "拼接图片组", contentType: "image-collection", multiple: true }],
  },
};
