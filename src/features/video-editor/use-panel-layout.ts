"use client";

import { useEffect, useState, type RefObject } from "react";

type Panels = { left: number; right: number; bottom: number };
const defaults: Panels = { left: 220, right: 260, bottom: 420 };
const keyFor = (projectId: string) => `mowo:video-editor:panels:v1:${projectId}`;

function readPanels(projectId: string): Panels {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(keyFor(projectId)) ?? "null");
    if (!saved || typeof saved !== "object") return defaults;
    const valid = (key: keyof Panels, min: number, max: number) => {
      const value = Reflect.get(saved, key);
      return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaults[key];
    };
    return { left: valid("left", 140, 1200), right: valid("right", 200, 1200), bottom: valid("bottom", 300, 620) };
  } catch { return defaults; }
}

/** Preferences belong to the project; viewport constraints never overwrite them. */
export function usePanelLayout(projectId: string, bodyRef: RefObject<HTMLDivElement | null>) {
  const [saved, setSaved] = useState<{ projectId: string | null; sizes: Panels }>({ projectId: null, sizes: defaults });
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSaved({ projectId, sizes: readPanels(projectId) }));
    return () => cancelAnimationFrame(frame);
  }, [projectId]);
  useEffect(() => {
    if (saved.projectId !== projectId) return;
    try { localStorage.setItem(keyFor(projectId), JSON.stringify(saved.sizes)); }
    catch { /* Layout remains usable when browser storage is unavailable. */ }
  }, [saved, projectId]);
  useEffect(() => {
    if (!bodyRef.current) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [bodyRef]);
  const preferred = saved.projectId === projectId ? saved.sizes : defaults;
  const available = Math.max(340, viewport.width - 292);
  const left = Math.min(preferred.left, Math.max(140, available - 200));
  const panels = { left, right: Math.min(preferred.right, Math.max(200, available - left)),
    bottom: Math.min(preferred.bottom, Math.max(300, viewport.height * .7)) };
  const resizePanel = (panel: keyof Panels, delta: number) => {
    const max = panel === "bottom" ? Math.max(300, viewport.height * .7)
      : Math.max(panel === "left" ? 140 : 200, viewport.width - panels[panel === "left" ? "right" : "left"] - 292);
    const min = panel === "left" ? 140 : panel === "right" ? 200 : 300;
    const value = Math.min(panel === "bottom" ? 620 : 1200, max, Math.max(min, panels[panel] + delta));
    setSaved((current) => ({ projectId, sizes: { ...(current.projectId === projectId ? current.sizes : defaults), [panel]: value } }));
  };
  return { panels, resizePanel };
}
