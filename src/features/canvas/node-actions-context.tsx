"use client";

import { createContext, useContext } from "react";
import type { CanvasModuleData } from "./types";
import type { FrameExtractionTask } from "@/features/frame-extraction/types";

export type CanvasNodeActions = {
  importImage: (nodeId: string, file: File) => Promise<void>;
  updateNodeData: (nodeId: string, data: Partial<CanvasModuleData>) => void;
  startFrameExtraction: (nodeId: string) => Promise<void>;
  updateFrameDraft: (nodeId: string, task: FrameExtractionTask) => void;
  openFrameViewer: (nodeId: string, sourceId: string) => void;
  materializeFrameSequence: (nodeId: string, sourceId: string) => Promise<void>;
  groupSelection: () => void;
  ungroupNode: (groupId: string) => void;
};

const CanvasNodeActionsContext = createContext<CanvasNodeActions | null>(null);

export const CanvasNodeActionsProvider = CanvasNodeActionsContext.Provider;

export function useCanvasNodeActions() {
  const actions = useContext(CanvasNodeActionsContext);
  if (!actions) throw new Error("Canvas node actions are unavailable");
  return actions;
}
