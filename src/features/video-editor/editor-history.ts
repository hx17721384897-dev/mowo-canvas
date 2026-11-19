import type { CuttingClip } from "./cutting-model";

export type EditorHistoryEntry =
  | { kind: "cuts"; before: number[]; after: number[] }
  | { kind: "clips"; before: CuttingClip[]; after: CuttingClip[] };
export type EditorHistory = { entries: EditorHistoryEntry[]; index: number };

export const emptyEditorHistory = (): EditorHistory => ({ entries: [], index: 0 });

export function recordEditorHistory(history: EditorHistory, entry: EditorHistoryEntry): EditorHistory {
  const entries = [...history.entries.slice(0, history.index), entry].slice(-100);
  return { entries, index: entries.length };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  return history.index > 0 ? { ...history, index: history.index - 1 } : history;
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  return history.index < history.entries.length ? { ...history, index: history.index + 1 } : history;
}
