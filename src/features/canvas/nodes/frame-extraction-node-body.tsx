"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/app/components/app-icon";
import type { FrameDraft, FrameExtractionTask, FrameInputReview, FrameSequenceDraft } from "@/features/frame-extraction/types";
import type { CanvasNodeBodyProps } from "../module-registry";
import { useCanvasNodeActions } from "../node-actions-context";
import styles from "../canvas.module.css";

const reviewLabels = { ready: "可拆帧", static: "静态图", unsupported: "不支持", unavailable: "无法读取", existing: "已有结果" };

function AdaptiveFrameThumbnail({ frame, index, selected, onSelect }: { frame: FrameDraft; index: number; selected?: boolean; onSelect?: () => void }) {
  const [ratio, setRatio] = useState<number>();
  const className = `${styles.frameThumb} ${selected ? styles.frameThumbSelected : ""} nodrag nopan`;
  const style = ratio ? { aspectRatio: String(ratio) } : undefined;
  const content = <><Image alt={`第 ${index + 1} 帧`} fill sizes="70px" src={frame.previewUrl} unoptimized
    onLoad={(event) => { const image = event.currentTarget; const next = image.naturalWidth / image.naturalHeight;
      if (Number.isFinite(next) && next > 0) setRatio((current) => current === next ? current : next); }} />
    <span>{String(index + 1).padStart(3, "0")}</span></>;
  return onSelect ? <button className={className} onClick={onSelect} style={style} type="button">{content}</button>
    : <div className={className} style={style}>{content}</div>;
}

export function FrameExtractionNodeBody(props: CanvasNodeBodyProps) {
  const { frameInputKey } = useCanvasNodeActions();
  const inputKey = frameInputKey(props.nodeId);
  return <FrameInputControls key={inputKey} {...props} inputKey={inputKey} />;
}

function FrameInputControls({ data, nodeId, inputKey }: CanvasNodeBodyProps & { inputKey: string }) {
  const { projectId, startFrameExtraction } = useCanvasNodeActions();
  const taskId = data.frameTask?.id;
  const taskVersion = JSON.stringify(data.frameTask?.sources.map(({ id, status }) => [id, status]) ?? []);
  const [retry, setRetry] = useState(0);
  const [review, setReview] = useState<{ key: string; items?: FrameInputReview[]; error?: string }>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const reviewKey = JSON.stringify([taskId, taskVersion, retry]);

  useEffect(() => {
    if (inputKey === "[]") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/frame-extraction/review", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, assetIds: JSON.parse(inputKey), taskId }),
          signal: controller.signal,
        });
        const payload = await response.json() as { items?: FrameInputReview[]; error?: string };
        if (!response.ok || !payload.items) throw new Error(payload.error ?? "检查输入失败");
        if (!controller.signal.aborted) setReview({ key: reviewKey, items: payload.items });
      } catch (error) {
        if (!controller.signal.aborted) setReview({ key: reviewKey, error: error instanceof Error ? error.message : "检查输入失败" });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [inputKey, projectId, taskId, reviewKey]);

  const current = review?.key === reviewKey ? review : undefined;
  const items = current?.items ?? [];
  const selected = items.filter((item) => item.status === "ready" && !excluded.includes(item.assetId));
  const summary = Object.entries(reviewLabels).map(([status, label]) => {
    const count = items.filter((item) => item.status === status).length;
    return count ? `${label} ${count} 张` : "";
  }).filter(Boolean).join(" · ");
  return (
    <div className={styles.frameProcessorBody}>
      <div>
        <span title={summary}>{inputKey === "[]" ? "连接图片或组内素材" : current?.error ?? (current ? summary : "正在检查输入…")}</span>
        {data.statusMessage ? <small>{data.statusMessage}</small> : null}
        {current?.error || items.some((item) => item.status === "unavailable") ? (
          <button className="nodrag nopan" disabled={data.busy} type="button" onClick={() => setRetry((value) => value + 1)}>重新检查</button>
        ) : null}
        {items.length ? <details className={`${styles.frameReview} nodrag nopan nowheel`}>
          <summary>查看明细</summary>
          <ul>{items.map((item) => <li key={item.assetId}>
            <label>
              {item.status === "ready" ? <input type="checkbox" disabled={data.busy} checked={!excluded.includes(item.assetId)}
                onChange={(event) => { const checked = event.currentTarget.checked; setExcluded((previous) => checked ? previous.filter((id) => id !== item.assetId) : [...previous, item.assetId]); }} /> : null}
              {item.name} · {item.format} · {item.reason ?? reviewLabels[item.status]}
            </label>
          </li>)}</ul>
        </details> : null}
        {selected.length > 50 ? <small>单次最多拆解 50 张，请在明细中缩小范围。</small> : null}
      </div>
      <button className="nodrag nopan" disabled={data.busy || !selected.length || selected.length > 50} onClick={() => void startFrameExtraction(nodeId, selected.map((item) => item.assetId))} type="button">{data.busy ? "处理中" : `开始拆帧（${selected.length}）`}</button>
      {data.frameTask?.sources.some((source) => source.status !== "failed") ? (
        <button className="nodrag nopan" disabled={data.busy} onClick={() => void startFrameExtraction(nodeId, [])} type="button">恢复结果组</button>
      ) : null}
    </div>
  );
}

function StackCover({ source }: { source: FrameSequenceDraft }) {
  const cover = source.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position)[0];
  return <span className={styles.frameStackCover}><i /><i />{cover ? <Image alt="" fill sizes="96px" src={cover.previewUrl} unoptimized /> : <Icon name="image" />}</span>;
}

export function FrameBatchNodeBody({ data, nodeId }: CanvasNodeBodyProps) {
  const { openBatchEditor } = useCanvasNodeActions();
  const sources = data.frameTask?.sources.filter((source) => source.status !== "failed") ?? [];
  return <div className={styles.frameBatchBody}>
    {sources.map((source) => {
      const frames = source.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position);
      return <details key={source.id} className={`${styles.frameBatchSequence} nodrag nopan nowheel`}>
        <summary><StackCover source={source} /><span><strong>{source.name}</strong><small>{frames.length} 帧 · {source.status === "saved" ? "已保存" : "草稿"}</small></span></summary>
        <div className={styles.frameQuickGrid}>{frames.map((frame, index) => <AdaptiveFrameThumbnail frame={frame} index={index} key={frame.id} />)}</div>
      </details>;
    })}
    <footer><button className="nodrag nopan" onClick={() => openBatchEditor(nodeId)} disabled={!sources.length} type="button"><Icon name="layers" />动画帧编辑</button></footer>
  </div>;
}

export function FrameResultNodeBody({ data, nodeId }: CanvasNodeBodyProps) {
  const { readFrameTasks, frameInputWarnings, updateOrderedFrames, setFrameDuration, refreshAssets, materializeFrameSequence, openFrameViewer, updateFrameDraft, updateNodeData } = useCanvasNodeActions();
  const tasks = readFrameTasks(nodeId);
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return tasks.flatMap((task, batchIndex) => task.sources.filter((source) => source.status !== "failed" && !seen.has(source.id))
      .map((source) => { seen.add(source.id); return { source, task, batchIndex }; }));
  }, [tasks]);
  const [activeId, setActiveId] = useState(sources[0]?.source.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [histories, setHistories] = useState<Record<string, string[][]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<{ sourceId: string; signature: string; state: "saving" | "saved" | "failed" }>();
  const savingRef = useRef(false);
  const activeEntry = sources.find((entry) => entry.source.id === activeId) ?? sources[0];
  const active = activeEntry?.source;
  const task = activeEntry?.task;
  const retained = active?.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position) ?? [];
  const frameSignature = JSON.stringify(retained.map(({ id, assetId, durationMs }) => [id, assetId, durationMs]));

  const warnings = frameInputWarnings(nodeId);
  if (!task || !active) return <div className={styles.frameResultEmpty}>{warnings.join(" ") || "请连接动画帧批次或有序图片组"}</div>;
  const manualGroupId = active.manualGroupId;
  const selectedFrame = retained.find((frame) => selected.has(frame.id));
  const undoHistory = histories[active.id] ?? [];
  const editable = !pending && !data.busy && active.status !== "saved";
  const setUndoHistory = (history: string[][]) => setHistories((previous) => ({ ...previous, [active.id]: history }));

  const patchOrder = async (orderedFrameIds: string[]) => {
    setPending(true);
    setError("");
    try {
      if (manualGroupId) {
        updateOrderedFrames(manualGroupId, orderedFrameIds);
        return true;
      }
      const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedFrameIds }) });
      const payload = await response.json() as { task?: FrameExtractionTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? "更新序列失败");
      updateFrameDraft(nodeId, payload.task);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "更新序列失败");
      return false;
    } finally { setPending(false); }
  };

  const removeSelected = async () => {
    const next = retained.filter((frame) => !selected.has(frame.id)).map((frame) => frame.id);
    if (!next.length || next.length === retained.length) return;
    if (await patchOrder(next)) {
      setUndoHistory([...undoHistory, retained.map((frame) => frame.id)]);
      setSelected(new Set());
    }
  };

  const undo = async () => {
    const previous = undoHistory.at(-1);
    if (previous && await patchOrder(previous)) setUndoHistory(undoHistory.slice(0, -1));
  };

  const move = async (direction: -1 | 1) => {
    if (selected.size !== 1) return;
    const index = retained.findIndex((frame) => selected.has(frame.id));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= retained.length) return;
    const next = retained.map((frame) => frame.id);
    [next[index], next[target]] = [next[target], next[index]];
    if (await patchOrder(next)) setUndoHistory([...undoHistory, retained.map((frame) => frame.id)]);
  };

  const changeDuration = async (frameId: string, durationMs: number) => {
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 3600000) return;
    if (manualGroupId) {
      setFrameDuration(manualGroupId, frameId, durationMs);
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${active.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedFrameIds: retained.map((frame) => frame.id), duration: { frameId, durationMs } }),
      });
      const payload = await response.json() as { task?: FrameExtractionTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? "更新帧时长失败");
      updateFrameDraft(nodeId, payload.task);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "更新帧时长失败");
    } finally { setPending(false); }
  };

  const save = async () => {
    if (savingRef.current || pending || (!manualGroupId && active.status === "saved")) return;
    savingRef.current = true;
    setPending(true);
    setSaveFeedback({ sourceId: active.id, signature: frameSignature, state: "saving" });
    if (manualGroupId) {
      setError("");
      try {
        const response = await fetch("/api/frame-extraction/ordered-sequences", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: task.projectId, groupId: manualGroupId, name: active.name,
            frames: retained.map(({ assetId, durationMs }) => ({ assetId, durationMs })) }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "保存序列资产失败");
        updateNodeData(nodeId, { statusMessage: "序列已保存到项目资产" });
        setSaveFeedback({ sourceId: active.id, signature: frameSignature, state: "saved" });
        refreshAssets();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "保存序列资产失败");
        setSaveFeedback({ sourceId: active.id, signature: frameSignature, state: "failed" });
      } finally { setPending(false); savingRef.current = false; }
      return;
    }
    updateNodeData(nodeId, { busy: true, statusMessage: "正在保存序列…" });
    setError("");
    try {
    const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${active.id}/save`, { method: "POST" });
    const payload = await response.json() as { sequence?: NonNullable<CanvasNodeBodyProps["data"]["savedSequences"]>[string]; error?: string };
    if (!response.ok || !payload.sequence) {
      throw new Error(payload.error ?? "保存失败");
    }
    updateNodeData(nodeId, { busy: false, statusMessage: "序列已保存", savedSequences: { ...data.savedSequences, [active.id]: payload.sequence } });
    updateFrameDraft(nodeId, { ...task, sources: task.sources.map((source) => source.id === active.id
      ? { ...source, status: "saved", collectionId: payload.sequence!.collectionId, frames: retained }
      : source) });
    setSaveFeedback({ sourceId: active.id, signature: frameSignature, state: "saved" });
    refreshAssets();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败");
      setSaveFeedback({ sourceId: active.id, signature: frameSignature, state: "failed" });
      updateNodeData(nodeId, { busy: false, statusMessage: "保存失败" });
    } finally { setPending(false); savingRef.current = false; }
  };

  const activeSaveFeedback = saveFeedback?.sourceId === active.id && saveFeedback.signature === frameSignature ? saveFeedback : undefined;
  const saveState = activeSaveFeedback?.state ?? (active.status === "saved" ? "saved" : undefined);

  return (
    <div className={styles.frameResultBody}>
      {warnings.map((warning, index) => <p key={index} role="status">{warning}</p>)}
      <div className={styles.frameSequenceTabs}>
        {sources.map(({ source, batchIndex }) => <button className={`${styles.frameSequenceCard} ${source.id === active.id ? styles.frameSequenceCardActive : ""} nodrag nopan`} key={source.id} onClick={() => { setActiveId(source.id); setSelected(new Set()); }} type="button"><StackCover source={source} /><span>{source.name}</span><small>{source.frames.filter((frame) => frame.retained).length} 帧 · {source.status === "saved" ? "已保存" : source.manualGroupId ? "有序组" : `批次 ${batchIndex + 1} · 草稿`}</small></button>)}
      </div>
      <div className={styles.frameQuickEditor}>
        <header><div><strong>{active.name}</strong><small>{active.width && active.height ? `${active.width} × ${active.height} · ` : ""}{retained.reduce((sum, frame) => sum + frame.durationMs, 0)}ms</small></div><button className="nodrag nopan" onClick={() => openFrameViewer(nodeId, active.id)} type="button">详细编辑</button></header>
        <div className={styles.frameQuickGrid}>{retained.map((frame, index) => <AdaptiveFrameThumbnail frame={frame} index={index} key={frame.id} selected={selected.has(frame.id)} onSelect={() => setSelected((current) => { const next = new Set(current); if (next.has(frame.id)) next.delete(frame.id); else next.add(frame.id); return next; })} />)}</div>
        {editable && selected.size === 1 && selectedFrame && <label className="nodrag nopan">停留时间（毫秒） <input
          key={`${selectedFrame.id}:${selectedFrame.durationMs}`} defaultValue={selectedFrame.durationMs} min={1} max={3600000} type="number"
          onBlur={(event) => { const value = event.currentTarget.valueAsNumber; if (event.currentTarget.validity.valid && value !== selectedFrame.durationMs) void changeDuration(selectedFrame.id, value); }} /></label>}
        {manualGroupId && <p>编辑同步到画布组，可通过画布撤销。</p>}
        <footer>{!manualGroupId && <button className="nodrag nopan" disabled={!editable || !undoHistory.length} onClick={() => void undo()} type="button">撤销</button>}<button className="nodrag nopan" disabled={!editable || selected.size !== 1} onClick={() => void move(-1)} type="button">左移</button><button className="nodrag nopan" disabled={!editable || selected.size !== 1} onClick={() => void move(1)} type="button">右移</button><button className="nodrag nopan" disabled={!editable || !selected.size || selected.size === retained.length} onClick={() => void removeSelected()} type="button">从序列移除</button><span /><button className="nodrag nopan" disabled={pending || saveState === "saved" || Boolean(manualGroupId && retained.some((frame) => !frame.assetId))} onClick={() => void save()} type="button">{saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : manualGroupId ? "保存为序列资产" : `保存序列（${retained.length}帧）`}</button>{!manualGroupId && <button className="nodrag nopan" disabled={pending || (active.status !== "saved" && !data.savedSequences?.[active.id])} onClick={() => void materializeFrameSequence(nodeId, active.id)} type="button">放入画布</button>}</footer>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
