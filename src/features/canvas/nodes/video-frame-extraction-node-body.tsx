"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useProgressNavigation } from "@/components/navigation-progress";
import { LoadingProgress } from "@/components/loading-progress";
import type { AssetSummary } from "@/features/assets/types";
import { useVideoFrameJobs } from "@/features/frame-extraction/client/use-video-frame-jobs";
import { emptyVideoFrameConfig, videoFrameErrorText, videoFrameJobActive, type VideoFrameConnectedInput } from "@/features/frame-extraction/video-frame-controls";
import { sampledFrameCount, validateVideoFrameRange } from "@/features/frame-extraction/video-frame-policy";
import type { FrameExtractionTask } from "@/features/frame-extraction/types";
import type { VideoFrameSettings } from "@/features/frame-extraction/video-frame-result";
import type { CanvasNodeBodyProps } from "../module-registry";
import { useCanvasNodeActions } from "../node-actions-context";
import styles from "./video-frame-extraction.module.css";

export function VideoFrameExtractionNodeBody({ data, nodeId }: CanvasNodeBodyProps) {
  const { projectId, videoInputKey, updateNodeData, attachVideoFrameTask } = useCanvasNodeActions();
  const navigate = useProgressNavigation();
  const inputKey = videoInputKey(nodeId);
  const inputs = useMemo(() => JSON.parse(inputKey) as VideoFrameConnectedInput[], [inputKey]);
  const config = data.videoFrameConfig ?? { ...emptyVideoFrameConfig, settings: { restore: true, every: 1, keep: 1 } };
  const controller = useVideoFrameJobs(projectId, nodeId);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loadedMetadataKey, setLoadedMetadataKey] = useState("");
  const [metadataRevision, setMetadataRevision] = useState(0);
  const metadataKey = JSON.stringify([projectId, inputKey, metadataRevision]);
  const metadataReady = loadedMetadataKey === metadataKey;
  const [error, setError] = useState("");
  const [sampling, setSampling] = useState<Record<string, boolean>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const form = useRef<HTMLFormElement>(null);
  const active = controller.jobs.find(videoFrameJobActive);
  const busy = !controller.loaded || controller.pending || controller.requesting || Boolean(active);
  const settingsFor = (id: string) => config.overrides[id] ?? config.settings;
  const selected = inputs.filter(input => !config.excluded.includes(input.assetId));
  const orderedJobs = [...controller.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const resultKey = JSON.stringify([...new Set(controller.jobs.map(job => job.resultTaskId).filter(Boolean))]);

  useEffect(() => { updateNodeData(nodeId, { busy }); }, [busy, nodeId, updateNodeData]);
  // Only read inexpensive asset metadata on connection. Do not decode/count frames here.
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store", signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error("素材信息读取失败，请重试。");
        const payload = await response.json() as { assets: AssetSummary[] };
        if (!abort.signal.aborted) { setAssets(payload.assets); setLoadedMetadataKey(metadataKey); setError(""); }
      }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [metadataKey, projectId]);

  useEffect(() => {
    const abort = new AbortController();
    const ids = JSON.parse(resultKey) as string[];
    void Promise.all(ids.map(async id => {
      const response = await fetch(`/api/frame-extraction/tasks/${encodeURIComponent(id)}`, { cache: "no-store", signal: abort.signal });
      const payload = await response.json() as { task?: FrameExtractionTask };
      if (!response.ok || !payload.task) throw new Error("结果读取失败，请点击恢复图片组。");
      if (!abort.signal.aborted) attachVideoFrameTask(nodeId, payload.task);
    })).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [resultKey, nodeId, attachVideoFrameTask, active?.updatedAt, metadataRevision]);

  const update = (id: string, value: VideoFrameSettings) => {
    updateNodeData(nodeId, { videoFrameConfig: { ...config, overrides: { ...config.overrides, [id]: value } } });
  };
  const inputIssue = (input: VideoFrameConnectedInput) => {
    const asset = assets.find(asset => asset.id === input.assetId);
    if (!asset) return "VIDEO_UNAVAILABLE";
    return validateVideoFrameRange(asset.duration ?? NaN, input.clip ? null : asset.size)[0];
  };
  const eligible = selected.filter(input => metadataReady && !inputIssue(input));
  const generate = () => {
    setError("");
    void controller.submit("extract", eligible.map(input => ({ assetId: input.assetId,
      settings: { ...settingsFor(input.assetId), every: 1, keep: 1, truncate: false, deferOutput: true } })));
  };
  const openEditor = (input: VideoFrameConnectedInput) => navigate(
    `/video-editor/${projectId}/${input.clip?.sourceAssetId ?? input.assetId}${input.clip ? `?clip=${input.assetId}` : ""}`,
    "正在打开视频观察页");
  const processing = active?.inputs.find(input => input.status === "running");
  const hasWaiting = selected.some(input => {
    const result = orderedJobs.find(job => job.mode === "extract" && job.inputs.some(item => item.assetId === input.assetId))?.inputs.find(item => item.assetId === input.assetId);
    return result?.settings.restore === settingsFor(input.assetId).restore && result.status === "analyzed" && result.analysis?.issue;
  });
  const hasExtracted = selected.some(input => orderedJobs.some(job => job.mode === "extract" && job.inputs.some(item => item.assetId === input.assetId && item.status === "ready")));

  return <form ref={form} className={`${styles.panel} nopan nowheel`} aria-label="视频拆帧设置" onSubmit={event => event.preventDefault()}>
    <div className={styles.summary}>选择素材类型，点击生成后开始处理</div>
    <small>每个视频支持 60 秒、200 MiB 以内；每次最多输出 150 张。连接时不判断输出帧数。</small>
    {!inputs.length && <p>连接视频、片段或包含视频的组。</p>}
    <div className={styles.sources}>
      {inputs.map(input => {
        const settings = settingsFor(input.assetId);
        const job = orderedJobs.find(job => job.mode === "extract" && job.inputs.some(item => item.assetId === input.assetId));
        const result = job?.inputs.find(item => item.assetId === input.assetId);
        const matches = result?.settings.restore === settings.restore;
        const waiting = matches && result?.status === "analyzed" && Boolean(result.analysis?.issue);
        const analysis = waiting ? result?.analysis : undefined;
        const issue = metadataReady ? inputIssue(input) : undefined;
        const frameCount = analysis?.estimatedFrameCount ?? 0;
        const sampleCount = sampledFrameCount(frameCount, settings);
        const rateNeeded = analysis?.issue === "TARGET_FPS_REQUIRED" || analysis?.issue === "TARGET_FPS_TOO_LOW";
        const rate = rates[input.assetId] ?? settings.targetFps ?? 24;
        const confirm = (next: VideoFrameSettings) => {
          if (job && form.current?.reportValidity()) void controller.action(job, "confirm", [{ assetId: input.assetId, settings: next }]);
        };
        const base = { ...result?.settings, restore: settings.restore, every: 1, keep: 1, truncate: false, deferOutput: true };
        return <section className={styles.source} key={input.assetId}>
          <label className={`${styles.sourceName} nodrag`}><input type="checkbox" disabled={busy}
            checked={!config.excluded.includes(input.assetId)} onChange={event => updateNodeData(nodeId, { videoFrameConfig: {
              ...config, excluded: event.target.checked ? config.excluded.filter(id => id !== input.assetId) : [...config.excluded, input.assetId],
            } })}/><span>{input.name}</span></label>
          <div className={`${styles.buttons} nodrag`} role="group" aria-label={`${input.name}素材类型`}>
            <button type="button" aria-pressed={settings.restore} disabled={busy} onClick={() => update(input.assetId, { restore: true, every: 1, keep: 1 })}>动画</button>
            <button type="button" aria-pressed={!settings.restore} disabled={busy} onClick={() => update(input.assetId, { restore: false, every: 1, keep: 1 })}>拍摄视频</button>
          </div>
          <small>{settings.restore ? "分析重复画面，按比例还原一拍二、一拍三；不确定时请你确认帧率。" : "保留原始帧，不自动合并相似画面；超限后可自行抽帧。"}</small>
          {!metadataReady && <small>正在检查大小和时长…</small>}
          {issue && <p className={styles.warning}>{videoFrameErrorText(issue)}</p>}
          {matches && result?.status === "failed" && <p className={styles.warning}>{videoFrameErrorText(result.errorCode ?? "PROCESSING_FAILED")}</p>}
          {matches && result?.status === "ready" && <strong className={styles.count}>已生成 {Math.min(150, result.analysis?.estimatedFrameCount ?? 0)} 张图片</strong>}
          {waiting && analysis && <>
            {rateNeeded ? <>
              <p className={styles.warning}>{analysis.issue === "TARGET_FPS_TOO_LOW" ? "目标帧率过低，不能保留全部不同画面，请提高帧率。" : "动画节奏暂时无法自动确定，请确认目标帧率后继续。"}</p>
              <small>源视频共 {analysis.sourceFrameCount} 帧。目标帧率决定每秒保留多少帧位，相同画面仍可占两张、三张。</small>
              <div className={`${styles.row} nodrag`}><label>目标帧率 <input aria-label="目标帧率" type="number" min={1} max={120} step="any" required
                value={rate} disabled={busy} onChange={event => { if (event.target.validity.valid) setRates(current => ({ ...current, [input.assetId]: event.target.valueAsNumber })); }}/></label>fps
                <button type="button" disabled={busy} onClick={() => { update(input.assetId, { ...settings, targetFps: rate }); confirm({ ...base, targetFps: rate }); }}>确认帧率并继续</button>
              </div>
            </> : <>
              <strong className={styles.warning}>处理后共 {frameCount} 张，超过 150 张上限</strong>
              {settings.restore && <small>已按动画节奏整理；连续重复画面保留相应帧位，目标帧率 {analysis.targetFps} fps。</small>}
              <div className={`${styles.buttons} nodrag`}>
                <button type="button" disabled={busy} onClick={() => confirm({ ...base, truncate: true })}>仅输出前 150 帧</button>
                <button type="button" disabled={busy} onClick={() => {
                  setSampling(current => ({ ...current, [input.assetId]: true }));
                  update(input.assetId, { ...settings, every: settings.every > 1 ? settings.every : 2, keep: 1 });
                }}>抽帧</button>
              </div>
              {sampling[input.assetId] && <>
                <div className={`${styles.row} nodrag`}>每 <input aria-label="间隔帧数" type="number" min={1} max={1000000} required value={settings.every} disabled={busy}
                  onChange={event => { if (event.target.validity.valid) update(input.assetId, { ...settings, every: event.target.valueAsNumber, keep: Math.min(settings.keep, event.target.valueAsNumber) }); }}/>
                  帧保留前 <input aria-label="保留帧数" type="number" min={1} max={settings.every} required value={settings.keep} disabled={busy}
                  onChange={event => { if (event.target.validity.valid) update(input.assetId, { ...settings, keep: event.target.valueAsNumber }); }}/> 帧</div>
                <strong className={styles.count}>选取后共 {sampleCount} 张</strong>
                <button className="nodrag" type="button" disabled={busy || sampleCount > 150 || sampleCount < 1}
                  onClick={() => confirm({ ...base, every: settings.every, keep: settings.keep })}>确认抽帧并输出</button>
                {sampleCount > 150 && <small>仍超过 150 张，请增大间隔或减少保留张数。</small>}
              </>}
            </>}
          </>}
          <button className={`${styles.link} nodrag`} type="button" onClick={() => openEditor(input)}>进入编辑页裁剪</button>
        </section>;
      })}
    </div>
    {!hasWaiting && <button className={`${styles.primary} nodrag`} type="button" disabled={busy || !metadataReady || !eligible.length || eligible.length > 50} onClick={generate}>{hasExtracted ? "重新生成图片组" : "生成图片组"}（{eligible.length} 个视频）</button>}
    {hasWaiting && <small>请在上方确认处理结果后继续输出，无需重新生成。</small>}
    {active && <LoadingProgress title={processing?.stage === "extracting" ? "正在生成图片组" : processing?.settings.restore ? "正在分析动画帧节奏" : "正在处理视频帧"}
      description={processing?.name} value={processing?.total ? (processing.completed ?? 0) / processing.total * 100 : undefined}/>}
    {(error || controller.error) && <p role="alert" className={styles.warning}>{error || controller.error}</p>}
    <footer className={`${styles.buttons} nodrag`}>
      {active && <button type="button" disabled={controller.requesting} onClick={() => void controller.action(active, "cancel")}>取消任务</button>}
      {!metadataReady && <button type="button" onClick={() => setMetadataRevision(value => value + 1)}>重新检查素材</button>}
      {(controller.error || !controller.loaded || controller.pending) && <button type="button" onClick={controller.refresh}>恢复连接／上次请求</button>}
      {orderedJobs.find(job => job.mode === "extract" && ["partial", "failed", "cancelled"].includes(job.status)) && !active && <button type="button" disabled={busy}
        onClick={() => void controller.action(orderedJobs.find(job => job.mode === "extract" && ["partial", "failed", "cancelled"].includes(job.status))!, "retry")}>重试未完成项</button>}
      {JSON.parse(resultKey).length > 0 && <button type="button" onClick={() => { controller.refresh(); setMetadataRevision(value => value + 1); }}>恢复图片组</button>}
    </footer>
  </form>;
}
