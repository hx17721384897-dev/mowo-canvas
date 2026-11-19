"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./video-editor.module.css";

function tickStep(pixelsPerFrame: number) {
  const target = Math.max(1, Math.ceil(80 / pixelsPerFrame));
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((value) => value * power).find((value) => value >= target) ?? 10 * power;
}

export function FrameTimeline({ frameCount, currentFrame, currentFrameApproximate, startFrame, endFrame, activeShot = null, shotCuts = [],
  editCuts = false, selectedCut = null, selectedSourceRange = null, onSelectCut, onPreviewCut, onMoveCut, onSeek, onPreview }: {
  frameCount: number; currentFrame: number | null; currentFrameApproximate: boolean; startFrame: number | null; endFrame: number | null;
  shotCuts?: number[];
  editCuts?: boolean; selectedCut?: number | null;
  onSelectCut?: (frame: number | null) => void;
  onPreviewCut?: (cuts: number[] | null) => void;
  onMoveCut?: (from: number, to: number) => void;
  activeShot?: { start: number; end: number } | null;
  selectedSourceRange?: { start: number; end: number } | null;
  onSeek: (ordinal: number) => void; onPreview: (ordinal: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const cutDrag = useRef<{ from: number; to: number; base: number[] } | null>(null);
  const [dragOverview, setDragOverview] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const minimum = Math.min(frameCount, Math.max(8, Math.floor(width / 22)));
  const visible = Math.max(1, Math.min(frameCount, Math.round(frameCount * (minimum / frameCount) ** (zoom / 100))));
  const maxOffset = Math.max(0, frameCount - visible);
  const left = Math.max(0, Math.min(maxOffset, offset));
  const pixelsPerFrame = width / visible;
  const frameAt = (clientX: number) => Math.max(0, Math.min(frameCount - 1,
    Math.floor(left + (clientX - (canvas.current?.getBoundingClientRect().left ?? 0)) / pixelsPerFrame)));
  const boundaryAt = (clientX: number) => Math.max(1, Math.min(frameCount - 1,
    Math.round(left + (clientX - (canvas.current?.getBoundingClientRect().left ?? 0)) / pixelsPerFrame)));
  const nearestCut = (clientX: number) => {
    const x = clientX - (canvas.current?.getBoundingClientRect().left ?? 0);
    let nearest: number | null = null;
    let distance = 9;
    for (const cut of shotCuts) {
      const nextDistance = Math.abs((cut - left) * pixelsPerFrame - x);
      if (nextDistance <= distance) { nearest = cut; distance = nextDistance; }
    }
    return nearest;
  };
  const moveCut = (clientX: number) => {
    const drag = cutDrag.current;
    if (!drag) return null;
    const index = drag.base.indexOf(drag.from);
    const lower = (drag.base[index - 1] ?? 0) + 1;
    const upper = (drag.base[index + 1] ?? frameCount) - 1;
    const next = Math.max(lower, Math.min(upper, boundaryAt(clientX)));
    drag.to = next;
    onPreviewCut?.(drag.base.map((cut) => cut === drag.from ? next : cut));
    return next;
  };
  const setZoomAt = useCallback((next: number, clientX: number) => {
    const anchorX = Math.max(0, Math.min(width, clientX - (canvas.current?.getBoundingClientRect().left ?? 0)));
    const anchorFrame = left + anchorX / pixelsPerFrame;
    const bounded = Math.max(0, Math.min(100, next));
    const nextVisible = Math.max(1, Math.min(frameCount, Math.round(frameCount * (minimum / frameCount) ** (bounded / 100))));
    setOffset(Math.max(0, Math.min(frameCount - nextVisible, anchorFrame - anchorX / width * nextVisible)));
    setZoom(bounded);
  }, [left, pixelsPerFrame, width, frameCount, minimum]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) { event.preventDefault(); setZoomAt(zoom + (event.deltaY < 0 ? 5 : -5), event.clientX); }
      else if (event.shiftKey || Math.abs(event.deltaX) > 0) { event.preventDefault(); setOffset(Math.max(0, Math.min(maxOffset, left + (event.deltaX || event.deltaY) / pixelsPerFrame))); }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom, setZoomAt, maxOffset, left, pixelsPerFrame]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * ratio);
    element.height = Math.round(86 * ratio);
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#171c24";
    context.fillRect(0, 0, width, 86);
    const blueStart = activeShot?.start ?? startFrame;
    const blueEnd = activeShot?.end ?? endFrame;
    if (blueStart !== null && blueEnd !== null && blueEnd > blueStart) {
      context.fillStyle = "#4d79c666";
      context.fillRect((blueStart - left) * pixelsPerFrame, 24,
        (blueEnd - blueStart) * pixelsPerFrame, 62);
    }
    if (activeShot && startFrame !== null && endFrame !== null && endFrame > startFrame) {
      context.strokeStyle = "#e6b978";
      context.setLineDash([5, 4]);
      context.strokeRect((startFrame - left) * pixelsPerFrame, 25, (endFrame - startFrame) * pixelsPerFrame, 60);
      context.setLineDash([]);
    }
    if (selectedSourceRange && selectedSourceRange.end > selectedSourceRange.start) {
      context.strokeStyle = "#e6f7fb";
      context.lineWidth = 2;
      context.strokeRect((selectedSourceRange.start - left) * pixelsPerFrame, 27,
        (selectedSourceRange.end - selectedSourceRange.start) * pixelsPerFrame, 55);
      context.lineWidth = 1;
    }
    context.strokeStyle = "#62c4d4";
    context.lineWidth = 1;
    for (const cut of shotCuts) {
      if (cut < left || cut > left + visible) continue;
      const x = Math.round((cut - left) * pixelsPerFrame) + 0.5;
      context.beginPath(); context.moveTo(x, 24); context.lineTo(x, 86); context.stroke();
    }
    if (editCuts && selectedCut !== null && shotCuts.includes(selectedCut)) {
      const x = Math.round((selectedCut - left) * pixelsPerFrame) + 0.5;
      context.strokeStyle = "#f7d277"; context.lineWidth = 3;
      context.beginPath(); context.moveTo(x, 24); context.lineTo(x, 86); context.stroke();
      context.lineWidth = 1;
    }
    if (pixelsPerFrame >= 8) {
      context.strokeStyle = "#394352";
      for (let frame = Math.ceil(left); frame <= Math.min(frameCount, left + visible); frame++) {
        const x = Math.round((frame - left) * pixelsPerFrame) + 0.5;
        context.beginPath(); context.moveTo(x, 43); context.lineTo(x, 86); context.stroke();
      }
    }
    const step = tickStep(pixelsPerFrame);
    context.font = "11px ui-monospace, monospace";
    context.fillStyle = "#bac7d8";
    context.strokeStyle = "#8290a3";
    for (let frame = Math.ceil(left / step) * step; frame <= Math.min(frameCount, left + visible); frame += step) {
      const x = Math.round((frame - left) * pixelsPerFrame) + 0.5;
      context.beginPath(); context.moveTo(x, 22); context.lineTo(x, 39); context.stroke();
      context.fillText(String(frame), x + 3, 16);
    }
    const head = dragFrame ?? currentFrame;
    if (head !== null && head >= left && head < left + visible) {
      const x = Math.round((head - left + 0.5) * pixelsPerFrame) + 0.5;
      context.strokeStyle = dragFrame === null && currentFrameApproximate ? "#a6b0bd" : dragFrame === null ? "#ffb86a" : "#f7d277";
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(x, 20); context.lineTo(x, 86); context.stroke();
      context.lineWidth = 1;
    }
    context.fillStyle = "#a9b6c9";
    context.fillText(`源帧 ${Math.floor(left)}–${Math.min(frameCount - 1, Math.ceil(left + visible) - 1)}`, 8, 79);
  }, [width, frameCount, left, visible, pixelsPerFrame, startFrame, endFrame, activeShot, selectedSourceRange, shotCuts, editCuts, selectedCut, currentFrame, currentFrameApproximate, dragFrame]);
  const moveOverview = (clientX: number) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    const center = (clientX - bounds.left) / bounds.width * frameCount;
    setOffset(Math.max(0, Math.min(maxOffset, center - visible / 2)));
  };
  return <div className={styles.frameTimeline} ref={container} data-active-shot-start={activeShot?.start} data-active-shot-end={activeShot?.end}>
    <div className={styles.timelineHeader}><strong>源帧时间轴</strong><span>可见 {visible} / {frameCount} 帧</span>
      <button type="button" onClick={() => { setZoom(0); setOffset(0); }}>适应全片</button>
      <label>缩放 <input aria-label="时间轴缩放" type="range" min="0" max="100" value={zoom}
        onChange={(event) => setZoomAt(Number(event.target.value), (canvas.current?.getBoundingClientRect().left ?? 0) + width / 2)} /></label></div>
    <canvas ref={canvas} className={styles.frameCanvas} data-selected-cut={selectedCut ?? undefined}
      aria-label={editCuts ? "源帧时间轴；拖动切点按帧校正，其他位置点击定位" : "源帧时间轴；点击或拖动定位帧"} role="slider"
      aria-valuemin={0} aria-valuemax={frameCount - 1} aria-valuenow={currentFrame ?? 0} tabIndex={0}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); onSeek(Math.max(0, Math.min(frameCount - 1, (currentFrame ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
      } }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const cut = editCuts ? nearestCut(event.clientX) : null;
        if (cut !== null) { cutDrag.current = { from: cut, to: cut, base: [...shotCuts] }; onSelectCut?.(cut); return; }
        if (editCuts) onSelectCut?.(null);
        const frame = frameAt(event.clientX); setDragFrame(frame); onPreview(frame);
      }}
      onPointerMove={(event) => {
        if (cutDrag.current) { moveCut(event.clientX); return; }
        if (dragFrame === null) return;
        const frame = frameAt(event.clientX); setDragFrame(frame); onPreview(frame);
      }}
      onPointerUp={(event) => {
        if (cutDrag.current) {
          const drag = cutDrag.current; const next = moveCut(event.clientX);
          cutDrag.current = null;
          if (next !== null && next !== drag.from) onMoveCut?.(drag.from, next);
          else onPreviewCut?.(null);
          return;
        }
        if (dragFrame === null) return;
        const frame = frameAt(event.clientX); setDragFrame(null); onSeek(frame);
      }}
      onPointerCancel={() => { cutDrag.current = null; onPreviewCut?.(null); setDragFrame(null); }}
      />
    <div className={styles.overview} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragOverview(true); moveOverview(event.clientX); }}
      onPointerMove={(event) => { if (dragOverview) moveOverview(event.clientX); }}
      onPointerUp={() => setDragOverview(false)} onPointerCancel={() => setDragOverview(false)}>
      {startFrame !== null && endFrame !== null && endFrame > startFrame && <span className={styles.overviewSelection}
        data-manual-selection="true"
        style={{ left: `${startFrame / frameCount * 100}%`, width: `${(endFrame - startFrame) / frameCount * 100}%` }} />}
      {activeShot && <span className={styles.overviewActiveShot} style={{ left: `${activeShot.start / frameCount * 100}%`, width: `${(activeShot.end - activeShot.start) / frameCount * 100}%` }} />}
      {selectedSourceRange && <span className={styles.overviewCuttingSource} data-selected-source-range={`${selectedSourceRange.start}:${selectedSourceRange.end}`}
        style={{ left: `${selectedSourceRange.start / frameCount * 100}%`, width: `${(selectedSourceRange.end - selectedSourceRange.start) / frameCount * 100}%` }} />}
      <span className={styles.overviewWindow} style={{ left: `${left / frameCount * 100}%`, width: `${visible / frameCount * 100}%` }} />
    </div>
  </div>;
}
