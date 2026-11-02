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
  Body: ComponentType<CanvasNodeBodyProps>;
};

export const canvasModuleRegistry: Record<CanvasModuleType, CanvasModuleDefinition> = {
  image: {
    type: "image",
    label: "图片",
    icon: "image",
    tone: "blue",
    width: 190,
    inputs: [],
    outputs: [
      { id: "image", label: "图片", contentType: "image", multiple: true },
    ],
    Body: ImageNodeBody,
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
