"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Icon } from "@/app/components/app-icon";
import type { FrameExtractionTask, FrameSequenceDraft } from "@/features/frame-extraction/types";
import type { CanvasNodeBodyProps } from "../module-registry";
import { useCanvasNodeActions } from "../node-actions-context";
import styles from "../canvas.module.css";

export function FrameExtractionNodeBody({ data, nodeId }: CanvasNodeBodyProps) {
  const { startFrameExtraction } = useCanvasNodeActions();
  const ready = data.frameTask?.sources.filter((source) => source.status !== "failed").length ?? 0;
  return (
    <div className={styles.frameProcessorBody}>
      <div><span>{data.busy ? "正在拆解…" : data.statusMessage ?? "连接 APNG 或 GIF 后开始"}</span>{ready ? <small>已生成 {ready} 组</small> : null}</div>
      <button className="nodrag nopan" disabled={data.busy} onClick={() => void startFrameExtraction(nodeId)} type="button">{data.busy ? "处理中" : "开始拆帧"}</button>
    </div>
  );
}

function StackCover({ source }: { source: FrameSequenceDraft }) {
  const cover = source.frames.find((frame) => frame.retained) ?? source.frames[0];
  return <span className={styles.frameStackCover}><i /><i />{cover ? <Image alt="" fill sizes="96px" src={cover.previewUrl} unoptimized /> : <Icon name="image" />}</span>;
}

export function FrameResultNodeBody({ data, nodeId }: CanvasNodeBodyProps) {
  const task = data.frameTask;
  const sources = useMemo(() => task?.sources.filter((source) => source.status !== "failed") ?? [], [task]);
  const [activeId, setActiveId] = useState(sources[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [undoHistory, setUndoHistory] = useState<string[][]>([]);
  const { materializeFrameSequence, openFrameViewer, updateFrameDraft, updateNodeData } = useCanvasNodeActions();
  const active = sources.find((source) => source.id === activeId) ?? sources[0];
  const retained = active?.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position) ?? [];

  if (!task || !active) return <div className={styles.frameResultEmpty}>等待拆帧结果</div>;

  const patchOrder = async (orderedFrameIds: string[]) => {
    const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedFrameIds }) });
    const payload = await response.json() as { task?: FrameExtractionTask; error?: string };
    if (!response.ok || !payload.task) throw new Error(payload.error ?? "更新序列失败");
    updateFrameDraft(nodeId, payload.task);
  };

  const removeSelected = async () => {
    const next = retained.filter((frame) => !selected.has(frame.id)).map((frame) => frame.id);
    if (!next.length || next.length === retained.length) return;
    setUndoHistory((history) => [...history, retained.map((frame) => frame.id)]);
    setSelected(new Set());
    await patchOrder(next);
  };

  const undo = async () => {
    const previous = undoHistory.at(-1);
    if (previous) { setUndoHistory((history) => history.slice(0, -1)); await patchOrder(previous); }
  };

  const move = async (direction: -1 | 1) => {
    if (selected.size !== 1) return;
    const index = retained.findIndex((frame) => selected.has(frame.id));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= retained.length) return;
    const next = retained.map((frame) => frame.id);
    [next[index], next[target]] = [next[target], next[index]];
    setUndoHistory((history) => [...history, retained.map((frame) => frame.id)]);
    await patchOrder(next);
  };

  const save = async () => {
    updateNodeData(nodeId, { busy: true, statusMessage: "正在保存序列…" });
    const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${active.id}/save`, { method: "POST" });
    const payload = await response.json() as { sequence?: NonNullable<CanvasNodeBodyProps["data"]["savedSequences"]>[string]; error?: string };
    if (!response.ok || !payload.sequence) {
      updateNodeData(nodeId, { busy: false, statusMessage: payload.error ?? "保存失败" });
      return;
    }
    updateNodeData(nodeId, { busy: false, statusMessage: "序列已保存", savedSequences: { ...data.savedSequences, [active.id]: payload.sequence } });
  };

  return (
    <div className={styles.frameResultBody}>
      <div className={styles.frameSequenceTabs}>
        {sources.map((source) => <button className={`${styles.frameSequenceCard} ${source.id === active.id ? styles.frameSequenceCardActive : ""} nodrag nopan`} key={source.id} onClick={() => { setActiveId(source.id); setSelected(new Set()); }} type="button"><StackCover source={source} /><span>{source.name}</span><small>{source.frames.filter((frame) => frame.retained).length} 帧</small></button>)}
      </div>
      <div className={styles.frameQuickEditor}>
        <header><div><strong>{active.name}</strong><small>{active.width} × {active.height} · {active.totalDurationMs}ms</small></div><button className="nodrag nopan" onClick={() => openFrameViewer(nodeId, active.id)} type="button">详细编辑</button></header>
        <div className={styles.frameQuickGrid}>{retained.map((frame, index) => <button className={`${styles.frameThumb} ${selected.has(frame.id) ? styles.frameThumbSelected : ""} nodrag nopan`} key={frame.id} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(frame.id)) next.delete(frame.id); else next.add(frame.id); return next; })} type="button"><Image alt={`第 ${index + 1} 帧`} fill sizes="70px" src={frame.previewUrl} unoptimized /><span>{String(index + 1).padStart(3, "0")}</span></button>)}</div>
        <footer><button className="nodrag nopan" disabled={!undoHistory.length} onClick={() => void undo()} type="button">撤销</button><button className="nodrag nopan" disabled={selected.size !== 1} onClick={() => void move(-1)} type="button">左移</button><button className="nodrag nopan" disabled={selected.size !== 1} onClick={() => void move(1)} type="button">右移</button><button className="nodrag nopan" disabled={!selected.size || selected.size === retained.length} onClick={() => void removeSelected()} type="button">移除所选</button><span /><button className="nodrag nopan" disabled={data.busy} onClick={() => void save()} type="button">保存序列（{retained.length}帧）</button><button className="nodrag nopan" disabled={!data.savedSequences?.[active.id]} onClick={() => void materializeFrameSequence(nodeId, active.id)} type="button">放入画布</button></footer>
      </div>
    </div>
  );
}
