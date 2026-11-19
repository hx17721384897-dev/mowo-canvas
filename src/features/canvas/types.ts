import type { Node } from "@xyflow/react";
import type { FrameExtractionTask, SavedFrameSequence } from "@/features/frame-extraction/types";
import type { GroupActionLayout } from "./group-quick-actions";
import type { CropPlan } from "./image-crop";
import type { VideoFrameConfig } from "@/features/frame-extraction/video-frame-controls";

export type CanvasContentType = "audio" | "image" | "image-collection" | "group-materials" | "text" | "video";

export type CanvasPortDefinition = {
  id: string;
  label: string;
  contentType: CanvasContentType;
  multiple: boolean;
};

export type CanvasModuleType = "audio" | "image" | "batch-crop" | "crop-result" | "frame-extraction" | "video-frame-extraction" | "frame-batch" | "frame-result" | "frame-stitch" | "text" | "video";

export type CanvasModuleData = {
  moduleType: CanvasModuleType;
  assetId?: string;
  clip?: { sourceAssetId: string; startFrame: number; endFrame: number; startSeconds: number; endSeconds: number; sequence: number };
  previewUrl?: string;
  derivationId?: string;
  title?: string;
  detail?: string;
  naturalSizeApplied?: boolean;
  textContent?: string;
  statusMessage?: string;
  busy?: boolean;
  variant?: "warm" | "cool";
  frameTask?: FrameExtractionTask;
  videoFrameConfig?: VideoFrameConfig;
  savedSequences?: Record<string, SavedFrameSequence>;
  cropPlan?: CropPlan;
};

export type CanvasModuleNode = Node<CanvasModuleData, "module">;

export type CanvasGroupData = {
  label: string;
  quickActionLayout?: GroupActionLayout;
  resizeMode?: "reflow" | "scale";
  scaleBase?: Record<string, { width: number; height: number }>;
  stitchResult?: boolean;
  orderedChildIds?: string[];
  frameDurationsMs?: Record<string, number>;
  frameTask?: FrameExtractionTask;
  frameSourceId?: string;
  frameSaved?: boolean;
  collapsed?: boolean;
  sequenceId?: string;
};

export type CanvasGroupNode = Node<CanvasGroupData, "group">;
export type CanvasNode = CanvasGroupNode | CanvasModuleNode;
