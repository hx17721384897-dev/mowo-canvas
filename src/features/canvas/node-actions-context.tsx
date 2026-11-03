"use client";

import { createContext, useContext } from "react";
import type { CanvasModuleData } from "./types";

export type CanvasNodeActions = {
  importImage: (nodeId: string, file: File) => Promise<void>;
  updateNodeData: (nodeId: string, data: Partial<CanvasModuleData>) => void;
};

const CanvasNodeActionsContext = createContext<CanvasNodeActions | null>(null);

export const CanvasNodeActionsProvider = CanvasNodeActionsContext.Provider;

export function useCanvasNodeActions() {
  const actions = useContext(CanvasNodeActionsContext);
  if (!actions) throw new Error("Canvas node actions are unavailable");
  return actions;
}
