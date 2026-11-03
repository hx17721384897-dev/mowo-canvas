import type { Node } from "@xyflow/react";

export type CanvasContentType = "audio" | "image" | "image-collection" | "text" | "video";

export type CanvasPortDefinition = {
  id: string;
  label: string;
  contentType: CanvasContentType;
  multiple: boolean;
};

export type CanvasModuleType = "audio" | "image" | "batch-crop" | "text" | "video";

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
};

export type CanvasModuleNode = Node<CanvasModuleData, "module">;

export type CanvasGroupData = {
  label: string;
};

export type CanvasGroupNode = Node<CanvasGroupData, "group">;
export type CanvasNode = CanvasGroupNode | CanvasModuleNode;
