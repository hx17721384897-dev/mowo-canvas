"use client";

import { useRef } from "react";
import styles from "./video-editor.module.css";

export function WorkspaceResizeHandle({ label, horizontal = false, value, min, max, onResize, onReset }: {
  label: string; horizontal?: boolean; value: number; min: number; max: number;
  onResize: (delta: number) => void; onReset: () => void;
}) {
  const drag = useRef<{ id: number; position: number } | null>(null);
  return <div role="separator" aria-label={label} aria-orientation={horizontal ? "horizontal" : "vertical"}
    aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    className={`${styles.resizeHandle} ${horizontal ? styles.horizontalHandle : styles.verticalHandle}`}
    title={`${label}：拖动调整，双击恢复默认，也可使用方向键`}
    onDoubleClick={onReset}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, position: horizontal ? event.clientY : event.clientX };
    }}
    onPointerMove={(event) => {
      if (drag.current?.id !== event.pointerId) return;
      const position = horizontal ? event.clientY : event.clientX;
      onResize(position - drag.current.position);
      drag.current.position = position;
    }}
    onPointerUp={(event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onLostPointerCapture={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => {
      const negative = horizontal ? "ArrowUp" : "ArrowLeft";
      const positive = horizontal ? "ArrowDown" : "ArrowRight";
      if (event.key !== negative && event.key !== positive) return;
      event.preventDefault();
      onResize((event.key === positive ? 1 : -1) * (event.shiftKey ? 40 : 10));
    }} />;
}
