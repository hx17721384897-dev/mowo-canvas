import type { Node } from "@xyflow/react";
import type { FrameExtractionTask, SavedFrameSequence } from "@/features/frame-extraction/types";

export type CanvasContentType = "audio" | "image" | "image-collection" | "text" | "video";

export type CanvasPortDefinition = {
  id: string;
  label: string;
  contentType: CanvasContentType;
  multiple: boolean;
};

export type CanvasModuleType = "audio" | "image" | "batch-crop" | "frame-extraction" | "frame-result" | "text" | "video";

export type CanvasModuleData = {
  moduleType: CanvasModuleType;
  assetId?: string;
  previewUrl?: string;
  title?: string;
  detail?: string;
  naturalSizeApplied?: boolean;
  textContent?: string;
  statusMessage?: string;
  busy?: boolean;
  variant?: "warm" | "cool";
  frameTask?: FrameExtractionTask;
  savedSequences?: Record<string, SavedFrameSequence>;
};

export type CanvasModuleNode = Node<CanvasModuleData, "module">;

export type CanvasGroupData = {
  label: string;
};

export type CanvasGroupNode = Node<CanvasGroupData, "group">;
export type CanvasNode = CanvasGroupNode | CanvasModuleNode;
