"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { FrameExtractionTask } from "./types";
import styles from "./frame-sequence-viewer.module.css";

type Props = {
  initialSourceId: string;
  task: FrameExtractionTask;
  onClose: () => void;
  onPlace: (sourceId: string) => void;
};

export function FrameSequenceViewer({ initialSourceId, task, onClose, onPlace }: Props) {
  const sources = useMemo(() => task.sources.filter((source) => source.status !== "failed"), [task]);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const sourceIndex = Math.max(0, sources.findIndex((source) => source.id === sourceId));
  const source = sources[sourceIndex];
  const frames = useMemo(() => source?.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position) ?? [], [source]);
  const frame = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))];

  useEffect(() => {
    if (!playing || frames.length < 2 || !frame) return;
    const timer = window.setTimeout(() => setFrameIndex((index) => (index + 1) % frames.length), frame.durationMs);
    return () => window.clearTimeout(timer);
  }, [frame, frames.length, playing]);

  if (!source || !frame) return null;
  const chooseFrame = (index: number) => { setFrameIndex(index); setPlaying(false); };
  const changeSource = (index: number) => { const next = sources[index]; if (next) { setFrameIndex(0); setPlaying(true); setSourceId(next.id); } };

  return (
    <div className={styles.backdrop} role="presentation">
      <section aria-labelledby="frame-viewer-title" aria-modal="true" className={styles.dialog} role="dialog">
        <header className={styles.header}><div><strong id="frame-viewer-title">逐帧查看</strong><span>{source.name} · {frames.length} 帧 · {source.totalDurationMs}ms</span></div><nav><button disabled={sourceIndex === 0} onClick={() => changeSource(sourceIndex - 1)} type="button">‹ 上一组</button><span>第 {sourceIndex + 1} / {sources.length} 组</span><button disabled={sourceIndex === sources.length - 1} onClick={() => changeSource(sourceIndex + 1)} type="button">下一组 ›</button></nav><button aria-label="关闭" className={styles.close} onClick={onClose} type="button">×</button></header>
        <div className={styles.body}>
          <section className={styles.previewPane}>
            <div className={styles.preview}><Image alt={`第 ${frameIndex + 1} 帧`} fill sizes="45vw" src={frame.previewUrl} unoptimized /></div>
            <div className={styles.playback}><button onClick={() => chooseFrame((frameIndex - 1 + frames.length) % frames.length)} type="button">‹ 上一帧</button><button className={styles.playButton} onClick={() => setPlaying((value) => !value)} type="button">{playing ? "Ⅱ 暂停" : "▶ 播放"}</button><button onClick={() => chooseFrame((frameIndex + 1) % frames.length)} type="button">下一帧 ›</button></div>
            <div className={styles.timeline}><span style={{ width: `${((frameIndex + 1) / frames.length) * 100}%` }} /></div>
            <p>第 {String(frameIndex + 1).padStart(2, "0")} / {frames.length} 帧 · {frame.timelineStartMs}ms · 停留 {frame.durationMs}ms</p>
          </section>
          <section className={styles.framePane}><h3>全部帧</h3><div className={styles.grid}>{frames.map((item, index) => <button className={index === frameIndex ? styles.active : ""} key={item.id} onClick={() => chooseFrame(index)} type="button"><span><Image alt="" fill sizes="90px" src={item.previewUrl} unoptimized /></span><small>{String(index + 1).padStart(3, "0")} · {item.durationMs}ms</small></button>)}</div></section>
        </div>
        <footer><button onClick={onClose} type="button">关闭</button><button className={styles.primary} onClick={() => onPlace(source.id)} type="button">将本组放入画布</button></footer>
      </section>
    </div>
  );
}
