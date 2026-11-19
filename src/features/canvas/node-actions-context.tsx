"use client";

import { createContext, useContext } from "react";
import type { CanvasModuleData } from "./types";
import type { FrameExtractionTask } from "@/features/frame-extraction/types";
import type { StitchOutput } from "@/features/frame-extraction/stitch-layout";
import type { GroupExportEntry } from "./group-export";

export type CanvasNodeActions = {
  importVideo: (nodeId: string, file: File) => Promise<boolean>;
  openCropSetup: (nodeId: string) => void;
  importImage: (nodeId: string, files: File[]) => Promise<void>;
  updateNodeData: (nodeId: string, data: Partial<CanvasModuleData>) => void;
  projectId: string;
  frameInputKey: (nodeId: string) => string;
  videoInputKey: (nodeId: string) => string;
  openVideoFrameExtraction: (nodeId: string) => void;
  attachVideoFrameTask: (nodeId: string, task: FrameExtractionTask) => void;
  startFrameExtraction: (nodeId: string, selectedIds: string[]) => Promise<void>;
  updateFrameDraft: (nodeId: string, task: FrameExtractionTask) => void;
  openBatchEditor: (nodeId: string, type?: "frame-result" | "frame-stitch") => void;
  placeStitchResults: (nodeId: string, outputs: StitchOutput[]) => void;
  readFrameTask: (nodeId: string, sourceId?: string) => FrameExtractionTask | undefined;
  frameInputWarnings: (nodeId: string) => string[];
  updateOrderedFrames: (groupId: string, orderedIds: string[]) => void;
  readFrameTasks: (nodeId: string) => FrameExtractionTask[];
  refreshAssets: () => void;
  openFrameViewer: (nodeId: string, sourceId: string) => void;
  materializeFrameSequence: (nodeId: string, sourceId: string) => Promise<void>;
  copyFrameGroup: (groupId: string) => Promise<void>;
  setGroupOrdered: (groupId: string) => Promise<void>;
  duplicateImage: (nodeId: string) => void;
  setFrameDuration: (groupId: string, memberId: string, durationMs: number, applyAll?: boolean) => void;
  previewOrderedGroup: (groupId: string) => void;
  groupMembers: (groupId: string) => Array<{ id: string; title: string; previewUrl?: string; moduleType?: string }>;
  groupExportManifest: (groupId: string) => { entries: GroupExportEntry[]; skipped: number };
  createOrderedGroup: () => void;
  groupSelection: () => void;
  ungroupNode: (groupId: string) => void;
  toggleGroup: (groupId: string) => void;
  arrangeGroup: (groupId: string) => Promise<void>;
  finishGroupResize: (groupId: string, width: number, height: number) => void;
  groupContentScaleEnabled: boolean;
  toggleGroupContentScale: () => void;
  groupCovers: ReadonlyMap<string, { count: number; preview?: string }>;
};

const CanvasNodeActionsContext = createContext<CanvasNodeActions | null>(null);

export const CanvasNodeActionsProvider = CanvasNodeActionsContext.Provider;

export function useCanvasNodeActions() {
  const actions = useContext(CanvasNodeActionsContext);
  if (!actions) throw new Error("Canvas node actions are unavailable");
  return actions;
}
