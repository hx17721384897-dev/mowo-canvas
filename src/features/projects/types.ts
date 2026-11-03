import type { Edge, Viewport } from "@xyflow/react";
import type { CanvasModuleNode } from "@/features/canvas/types";

export type ProjectSummary = {
  id: string;
  name: string;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CanvasDocumentState = {
  schemaVersion: 1;
  nodes: CanvasModuleNode[];
  edges: Edge[];
  viewport: Viewport;
};
