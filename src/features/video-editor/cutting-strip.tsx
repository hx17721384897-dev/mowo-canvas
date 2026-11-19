"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { clipSeconds, moveCuttingClip, trimCuttingClip, type CuttingClip } from "./cutting-model";
import styles from "./video-editor.module.css";

type Drag = { id: string; edge: "in" | "out" | null; pointerId: number; startX: number;
  originalFrame: number; frame: number; insertion: number; x: number; moved: boolean };

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600), minutes = Math.floor(whole / 60) % 60, rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function tickStep(pixelsPerSecond: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(.001, 80 / pixelsPerSecond)));
  return [1, 2, 5, 10].map((value) => value * power).find((value) => value * power >= 80 / pixelsPerSecond) ?? 10 * power;
}

export function CuttingStrip({ name, clips, sourceTimes, sourceDuration, duration, position, selectedId,
  shotCuts, canSplit, disabled, exportUrl, outputBusy, outputMessage, onSaveOutput, frameBaseUrl,
  onSelect, onSeek, onSplit, onDelete, onReset, onTrim, onMove }: {
  name: string; clips: CuttingClip[]; sourceTimes: number[]; sourceDuration: number;
  duration: number; position: number; selectedId: string | null; shotCuts: number[]; canSplit: boolean; disabled: boolean;
  exportUrl: string | null; outputBusy: boolean; outputMessage: string; onSaveOutput: () => void; frameBaseUrl: string;
  onSelect: (id: string) => void; onSeek: (seconds: number) => void;
  onSplit: () => void; onDelete: () => void; onReset: () => void;
  onTrim: (id: string, edge: "in" | "out", frame: number) => void;
  onMove: (id: string, insertion: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null), lastManualScroll = useRef(0);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [viewWidth, setViewWidth] = useState(800), [scrollLeft, setScrollLeft] = useState(0);
  // undefined = initial close view, null = fit the whole composition, number = user zoom.
  const [scale, setScale] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitScale = duration > 0 ? viewWidth / duration : 1;
  const pixelsPerSecond = scale === null ? fitScale : Math.max(fitScale, scale ?? viewWidth / 24);
  const contentWidth = Math.max(viewWidth, Math.ceil(duration * pixelsPerSecond) + 2);
  const zoomAt = useCallback((next: number, anchorX: number) => {
    const element = viewport.current;
    if (!element || duration <= 0) return;
    const bounded = Math.max(fitScale, Math.min(Math.max(800, fitScale), next));
    const anchorSeconds = (element.scrollLeft + anchorX) / pixelsPerSecond;
    setScale(bounded);
    requestAnimationFrame(() => { element.scrollLeft = Math.max(0, anchorSeconds * bounded - anchorX); });
  }, [duration, fitScale, pixelsPerSecond]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomAt(pixelsPerSecond * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX - element.getBoundingClientRect().left);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [pixelsPerSecond, zoomAt]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || dragRef.current || performance.now() - lastManualScroll.current < 2000) return;
    const head = position * pixelsPerSecond;
    if (head < element.scrollLeft || head > element.scrollLeft + element.clientWidth - 24)
      element.scrollLeft = Math.max(0, head - element.clientWidth / 2);
  }, [position, pixelsPerSecond]);

  const nearestFrame = (seconds: number) => {
    let low = 0, high = sourceTimes.length;
    while (low < high) { const mid = (low + high) >>> 1; if (sourceTimes[mid] < seconds) low = mid + 1; else high = mid; }
    const before = Math.max(0, low - 1), after = Math.min(sourceTimes.length, low);
    const a = sourceTimes[before] ?? 0, b = sourceTimes[after] ?? sourceDuration;
    return Math.abs(seconds - a) <= Math.abs(b - seconds) ? before : after;
  };
  const insertionAt = (clientX: number, movedId: string) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return 0;
    const x = Math.max(0, clientX - box.left);
    let offset = 0, insertion = 0;
    for (const clip of clips) {
      if (clip.id === movedId) continue;
      const width = clipSeconds(clip, sourceTimes, sourceDuration) * pixelsPerSecond;
      if (x < offset + width / 2) break;
      offset += width; insertion++;
    }
    return insertion;
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, clip: CuttingClip, edge: Drag["edge"]) => {
    if (!sourceTimes.length || disabled) return;
    event.preventDefault();
    track.current?.setPointerCapture(event.pointerId);
    const frame = edge === "out" ? clip.outFrame : clip.inFrame;
    dragRef.current = { id: clip.id, edge, pointerId: event.pointerId, startX: event.clientX,
      originalFrame: frame, frame, insertion: clips.findIndex((item) => item.id === clip.id),
      x: event.clientX, moved: false };
    onSelect(clip.id);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current, box = track.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !box) return;
    const moved = drag.moved || Math.abs(event.clientX - drag.startX) >= 4;
    if (!moved) return;
    const element = viewport.current;
    if (element) {
      const view = element.getBoundingClientRect();
      if (event.clientX > view.right - 24) element.scrollLeft += 18;
      else if (event.clientX < view.left + 24) element.scrollLeft -= 18;
    }
    const clip = clips.find((item) => item.id === drag.id);
    if (!clip) return;
    let frame = drag.frame;
    if (drag.edge) {
      const base = drag.edge === "in" ? sourceTimes[clip.inFrame]
        : clip.outFrame === sourceTimes.length ? sourceDuration : sourceTimes[clip.outFrame];
      const candidate = nearestFrame(base + (event.clientX - drag.startX) / pixelsPerSecond);
      const snap = shotCuts.find((cut) => Math.abs(cut - candidate) <= 3);
      frame = drag.edge === "in" ? Math.max(0, Math.min(clip.outFrame - 1, snap ?? candidate))
        : Math.min(sourceTimes.length, Math.max(clip.inFrame + 1, snap ?? candidate));
    }
    const next = { ...drag, moved, frame, x: event.clientX - box.left,
      insertion: drag.edge ? drag.insertion : insertionAt(event.clientX, drag.id) };
    dragRef.current = next; setPreview(next);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null; setPreview(null);
    if (!drag.moved) return;
    if (drag.edge) { if (drag.frame !== drag.originalFrame) onTrim(drag.id, drag.edge, drag.frame); }
    else onMove(drag.id, drag.insertion);
  };
  const seekAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (box && duration > 0) onSeek(Math.max(0, Math.min(duration, (clientX - box.left) / pixelsPerSecond)));
  };
  const seekLane = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId); seekAt(event.clientX);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX);
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      seekAt(event.clientX);
    },
  };
  const visualClips = preview?.moved ? preview.edge
    ? trimCuttingClip(clips, preview.id, preview.edge, preview.frame)
    : moveCuttingClip(clips, preview.id, preview.insertion) : clips;
  const laidOut = useMemo(() => {
    const items: { clip: CuttingClip; left: number; width: number }[] = [];
    for (const clip of visualClips) {
      const width = clipSeconds(clip, sourceTimes, sourceDuration) * pixelsPerSecond;
      const previous = items.at(-1);
      items.push({ clip, left: previous ? previous.left + previous.width : 0, width });
    }
    return items;
  }, [visualClips, sourceTimes, sourceDuration, pixelsPerSecond]);
  const tick = tickStep(pixelsPerSecond), ticks: number[] = [];
  const firstTick = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / tick) * tick);
  const lastTick = Math.min(duration, (scrollLeft + viewWidth) / pixelsPerSecond + tick);
  for (let second = firstTick; second <= lastTick && ticks.length < 100; second += tick) ticks.push(second);
  const floating = preview?.moved && !preview.edge ? laidOut.find((item) => item.clip.id === preview.id) : null;
  return <section className={styles.cuttingStrip} aria-label="视频编辑区">
    <div className={styles.cuttingHeader}><strong>成片剪辑</strong><span>点击片段选中 · 点击时间尺定位</span>
      <button type="button" disabled={disabled || !canSplit} onClick={onSplit}>在播放头拆分</button>
      <button type="button" disabled={disabled || !selectedId || selectedId === "pending"} onClick={onDelete}>删除片段</button>
      {!clips.length && !!sourceTimes.length && <button type="button" disabled={disabled} onClick={onReset}>加入原片</button>}
      {exportUrl ? <a className={styles.cuttingExport} href={exportUrl} target="_blank" rel="noopener">下载 MP4</a>
        : <button type="button" disabled>下载 MP4</button>}
      <button type="button" disabled={!exportUrl || outputBusy} onClick={onSaveOutput}>
        {outputBusy ? "正在生成成片…" : "保存到素材库并放入画布"}</button>
      {outputMessage && <span role="status">{outputMessage}</span>}
    </div>
    <div className={styles.cuttingTools}><span>成片 {clock(position)} / {clock(duration)}</span>
      <div className={styles.cuttingZoom}>
        <button type="button" aria-label="缩小剪辑时间轴" disabled={pixelsPerSecond <= fitScale + .01}
          onClick={() => zoomAt(pixelsPerSecond / 1.5, viewWidth / 2)}>−</button>
        <button type="button" onClick={() => { setScale(null); if (viewport.current) viewport.current.scrollLeft = 0; }}>适应全片</button>
        <button type="button" aria-label="放大剪辑时间轴" onClick={() => zoomAt(pixelsPerSecond * 1.5, viewWidth / 2)}>＋</button>
        <small>Ctrl＋滚轮缩放 · 横向滚动查看</small>
      </div>
    </div>
    <div className={styles.cuttingViewport} ref={viewport} onScroll={(event) => {
      setScrollLeft(event.currentTarget.scrollLeft); lastManualScroll.current = performance.now();
    }}>
      <div className={styles.cuttingTrack} ref={track} style={{ width: contentWidth }}
        onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setPreview(null); }}>
        <button type="button" className={styles.cuttingRuler} aria-label="片段上方定位区" {...seekLane}>
          {ticks.map((second) => <span key={second} className={styles.cuttingTick} style={{ left: second * pixelsPerSecond }}>{clock(second)}</span>)}
        </button>
        <div className={styles.cuttingClips}>{laidOut.length ? laidOut.map(({ clip, left, width }) => {
          const count = Math.min(24, Math.max(1, Math.ceil(width / 96)));
          return <div key={clip.id} className={`${styles.cuttingClip} ${preview?.id === clip.id && preview.moved && !preview.edge ? styles.cuttingClipMoving : ""}`}
            style={{ left, width }}>
            <button type="button" className={styles.cuttingClipBody} aria-label={`选中片段 源帧 ${clip.inFrame}–${clip.outFrame - 1}`}
              aria-pressed={selectedId === clip.id} onClick={() => onSelect(clip.id)}
              onPointerDown={(event) => begin(event, clip, null)} title={name}>
              <span className={styles.cuttingClipTitle}>{name}<small>源帧 {clip.inFrame}–{clip.outFrame - 1}</small></span>
              <span className={styles.cuttingFrames} aria-hidden="true">{Array.from({ length: count }, (_, index) => {
                const frame = Math.min(clip.outFrame - 1, clip.inFrame + Math.floor(index * (clip.outFrame - clip.inFrame) / count));
                // eslint-disable-next-line @next/next/no-img-element
                return <img key={`${frame}:${index}`} loading="lazy" draggable={false} alt="" src={`${frameBaseUrl}/${frame}`} />;
              })}</span>
            </button>
            <button type="button" className={`${styles.cuttingEdge} ${styles.cuttingEdgeStart}`}
              aria-label={`修剪片段 ${clip.inFrame}–${clip.outFrame - 1} 起点`}
              onPointerDown={(event) => begin(event, clip, "in")} />
            <button type="button" className={`${styles.cuttingEdge} ${styles.cuttingEdgeEnd}`}
              aria-label={`修剪片段 ${clip.inFrame}–${clip.outFrame - 1} 终点`}
              onPointerDown={(event) => begin(event, clip, "out")} />
          </div>;
        }) : <div className={styles.cuttingEmpty}>{sourceTimes.length ? "成片为空，点击「加入原片」重新开始" : "正在准备帧索引，完成后可剪辑"}</div>}</div>
        <button type="button" className={styles.cuttingSeekLane} aria-label="片段下方定位区" {...seekLane} />
        {duration > 0 && <div className={styles.cuttingPlayhead} aria-hidden="true" style={{ left: position * pixelsPerSecond }} />}
        {floating && <div className={styles.cuttingInsert} aria-hidden="true" style={{ left: floating.left }} />}
        {floating && <div className={styles.cuttingDragGhost} aria-hidden="true" style={{ left: preview!.x, width: Math.min(220, Math.max(72, floating.width)) }}>
          <span>移动到这里</span><small>源帧 {floating.clip.inFrame}–{floating.clip.outFrame - 1}</small>
        </div>}
        {preview?.edge && <div className={styles.cuttingTrimPreview}>边界：源帧 {preview.frame}</div>}
      </div>
    </div>
  </section>;
}
