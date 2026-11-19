"use client";

import { useEffect, useSyncExternalStore } from "react";
import { normalizeQuickActions, type QuickActionDefault, type QuickActionLayout } from "./quick-actions";

const changeEvent = "mowo-quick-actions-changed";
export const quickActionStorageKey = (kind: string) => `mowo:quick-actions:v1:${kind}`;

function read(kind: string) {
  try { return localStorage.getItem(quickActionStorageKey(kind)); }
  catch { return null; }
}
function parse(raw: string | null): unknown {
  try { return raw ? JSON.parse(raw) : undefined; }
  catch { return undefined; }
}
function subscribe(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", listener);
  };
}
function write(kind: string, layout: QuickActionLayout) {
  localStorage.setItem(quickActionStorageKey(kind), JSON.stringify(layout));
  window.dispatchEvent(new Event(changeEvent));
}

export function useQuickActionPreferences(kind: string, actions: QuickActionDefault[], legacy?: unknown) {
  const raw = useSyncExternalStore(subscribe, () => read(kind), () => null);
  useEffect(() => {
    if (!legacy || read(kind) !== null) return;
    try { write(kind, normalizeQuickActions(actions, legacy)); }
    catch { /* The toolbar remains usable when browser storage is unavailable. */ }
  }, [kind, actions, legacy]);
  return {
    layout: normalizeQuickActions(actions, parse(raw) ?? legacy),
    save: (layout: QuickActionLayout) => write(kind, normalizeQuickActions(actions, layout)),
  };
}
