import type { ComponentType } from "react";
import type { IconName } from "@/app/components/app-icon";
import { CropNodeBody } from "./nodes/crop-node-body";
import { ImageNodeBody } from "./nodes/image-node-body";
import type { CanvasModuleData, CanvasModuleType, CanvasPortDefinition } from "./types";

export type CanvasNodeBodyProps = { data: CanvasModuleData };

export type CanvasModuleDefinition = {
  type: CanvasModuleType;
  label: string;
  icon: IconName;
  tone: "blue" | "violet";
  width: number;
  inputs: CanvasPortDefinition[];
  outputs: CanvasPortDefinition[];
  Body?: ComponentType<CanvasNodeBodyProps>;
};

export const canvasModuleRegistry: Record<CanvasModuleType, CanvasModuleDefinition> = {
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
    Body: ImageNodeBody,
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
    Body: CropNodeBody,
  },
};

export function getCanvasModule(type: CanvasModuleType) {
  return canvasModuleRegistry[type];
}
