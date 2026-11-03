import type { Edge, Viewport } from "@xyflow/react";
import type { CanvasNode } from "@/features/canvas/types";

export type ProjectSummary = {
  id: string;
  name: string;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CanvasDocumentState = {
  schemaVersion: 1;
  nodes: CanvasNode[];
  edges: Edge[];
  viewport: Viewport;
};
