import type { Node } from "@xyflow/react";

export type CanvasContentType = "image" | "image-collection" | "text" | "video";

export type CanvasPortDefinition = {
  id: string;
  label: string;
  contentType: CanvasContentType;
  multiple: boolean;
};

export type CanvasModuleType = "image" | "batch-crop";

export type CanvasModuleData = {
  moduleType: CanvasModuleType;
  assetId?: string;
  previewUrl?: string;
  title?: string;
  detail?: string;
  variant?: "warm" | "cool";
};

export type CanvasModuleNode = Node<CanvasModuleData, "module">;
