"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { stitchLayout, type StitchOutput, type StitchSettings } from "@/features/frame-extraction/stitch-layout";
import { useCanvasNodeActions } from "../node-actions-context";
import type { CanvasNodeBodyProps } from "../module-registry";
import styles from "../canvas.module.css";

export function FrameStitchNodeBody({ nodeId }: CanvasNodeBodyProps) {
  const { projectId, readFrameTask, placeStitchResults } = useCanvasNodeActions();
  const task = readFrameTask(nodeId);
  const sources = (task?.sources ?? []).filter((source) => source.status !== "failed" && source.width && source.height && source.frames.some((frame) => frame.retained));
  const [activeId, setActiveId] = useState("");
  const [columns, setColumns] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<StitchSettings>({ gap: 8, margin: 8, background: "transparent" });
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [message, setMessage] = useState("");
  const active = sources.find((source) => source.id === activeId) ?? sources[0];
  const frames = active?.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position) ?? [];
  const settingsFor = (id: string, count: number) => ({ ...settings, columns: columns[id] ? Math.min(count, columns[id]) : undefined });
  const layout = active && stitchLayout(frames.length, active.width!, active.height!, settingsFor(active.id, frames.length));
  const draft = sources.some((source) => source.status !== "saved");
  const total = sources.reduce((sum, source) => sum + source.frames.filter((frame) => frame.retained).length, 0);
  const run = async () => {
    if (!task || !sources.length || sources.length > 50 || running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      const sequences = sources.map((source) => {
        const frameIds = source.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position).map((frame) => frame.id);
        return { sourceId: source.id, frameIds, settings: settingsFor(source.id, frameIds.length) };
      });
      const response = await fetch("/api/frame-extraction/stitch", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, taskId: task.id, sequences }) });
      const payload = await response.json() as { outputs?: StitchOutput[]; failures?: string[]; error?: string };
      if (!response.ok || !payload.outputs) throw new Error(payload.error ?? "拼接失败");
      if (payload.outputs.length) placeStitchResults(nodeId, payload.outputs);
      setMessage([`已生成 ${payload.outputs.length} 张拼图`, ...(payload.failures ?? [])].join(" · "));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "拼接失败");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return <div className={styles.stitchBody}>
    <p>{sources.length ? `${sources.length} 组序列 · 共 ${total} 帧${draft ? " · 含草稿" : ""}` : "请连接动画帧批次或序列子组"}</p>
    {layout && active ? <details className="nodrag nopan nowheel">
      <summary>预览与设置</summary>
      {sources.length > 1 && <label>序列<select value={active.id} disabled={busy} onChange={(event) => setActiveId(event.target.value)}>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select></label>}
      <label>列数<select value={columns[active.id] ? Math.min(columns[active.id], frames.length) : 0} disabled={busy} onChange={(event) => {
        const value = Number(event.target.value);
        setColumns((current) => ({ ...current, [active.id]: value }));
      }}><option value={0}>自动推荐</option>{Array.from({ length: frames.length }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label>
      <label>间距<input type="number" min={0} max={128} value={settings.gap} disabled={busy} onChange={(event) => setSettings({ ...settings, gap: Math.max(0, Math.min(128, Math.round(Number(event.target.value)))) })} /></label>
      <label>外边距<input type="number" min={0} max={128} value={settings.margin} disabled={busy} onChange={(event) => setSettings({ ...settings, margin: Math.max(0, Math.min(128, Math.round(Number(event.target.value)))) })} /></label>
      <label>背景<select value={settings.background} disabled={busy} onChange={(event) => setSettings({ ...settings, background: event.target.value === "white" ? "white" : "transparent" })}><option value="transparent">透明</option><option value="white">白色</option></select></label>
      <p>{layout.columns} 列 × {layout.rows} 行 · {layout.width} × {layout.height} px · 空 {layout.columns * layout.rows - frames.length} 格</p>
      <div className={styles.stitchPreviewScroll}>
        <div className={styles.stitchPreview} style={{ aspectRatio: `${layout.width} / ${layout.height}`, backgroundColor: settings.background === "white" ? "white" : undefined }}>
          {layout.cells.slice(0, 64).map((cell, index) => <div className={styles.stitchCell} key={frames[index].id} style={{
            left: `${cell.left / layout.width * 100}%`, top: `${cell.top / layout.height * 100}%`,
            width: `${layout.cellWidth / layout.width * 100}%`, height: `${layout.cellHeight / layout.height * 100}%`,
          }}><Image src={frames[index].previewUrl} alt="" fill unoptimized sizes="96px" /><small>{index + 1}</small></div>)}
        </div>
      </div>
      {frames.length > 64 && <p>预览显示前 64 帧，输出包含全部保留帧。</p>}
    </details> : null}
    {sources.length > 50 && <p role="status">单次最多拼接 50 组，请连接较小批次或单个子组。</p>}
    <button className={`${styles.stitchRun} nodrag nopan`} type="button" disabled={busy || !sources.length || sources.length > 50} onClick={() => void run()}>{busy ? "拼接中…" : "开始拼接"}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
