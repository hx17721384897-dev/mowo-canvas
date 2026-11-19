import type { ComponentType } from "react";
import { CropNodeBody } from "./nodes/crop-node-body";
import { CropResultNodeBody } from "./nodes/crop-result-node-body";
import { ImageNodeBody } from "./nodes/image-node-body";
import { FrameBatchNodeBody, FrameExtractionNodeBody, FrameResultNodeBody } from "./nodes/frame-extraction-node-body";
import { FrameStitchNodeBody } from "./nodes/frame-stitch-node-body";
import { VideoFrameExtractionNodeBody } from "./nodes/video-frame-extraction-node-body";
import { canvasModules, type CanvasModuleMetadata } from "./module-metadata";
import type { CanvasModuleData, CanvasModuleType } from "./types";

export type CanvasNodeBodyProps = { data: CanvasModuleData; nodeId: string };
export type CanvasModuleDefinition = CanvasModuleMetadata & { Body?: ComponentType<CanvasNodeBodyProps> };

const bodies: Partial<Record<CanvasModuleType, ComponentType<CanvasNodeBodyProps>>> = {
  image: ImageNodeBody,
  "batch-crop": CropNodeBody,
  "crop-result": CropResultNodeBody,
  "frame-extraction": FrameExtractionNodeBody,
  "video-frame-extraction": VideoFrameExtractionNodeBody,
  "frame-result": FrameResultNodeBody,
  "frame-stitch": FrameStitchNodeBody,
  "frame-batch": FrameBatchNodeBody,
};

export function getCanvasModule(type: CanvasModuleType): CanvasModuleDefinition {
  return { ...canvasModules[type], Body: bodies[type] };
}
