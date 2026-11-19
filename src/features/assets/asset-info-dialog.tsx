"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetSummary, AssetSequence } from "./types";
import type { AssetSourceView } from "./asset-source-types";
import { sourceCategory, sourceRelations } from "./asset-source-model";
import styles from "./asset-ui.module.css";

export function AssetInfoDialog({ projectId, assetId, onClose, onLocate, canvasAssetIds }: {
  projectId: string; assetId: string; onClose: () => void;
  onLocate?: (assetId: string) => void; canvasAssetIds: ReadonlySet<string>;
}) {
  const [data, setData] = useState<{ assets: AssetSummary[]; sequences: AssetSequence[]; sourceView: AssetSourceView } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("读取素材信息失败"); return response.json(); })
      .then((payload) => { if (!controller.signal.aborted) setData(payload); })
      .catch(() => { if (!controller.signal.aborted) setError("读取素材信息失败"); });
    return () => controller.abort();
  }, [projectId]);
  const info = useMemo(() => {
    if (!data) return null;
    const assets = new Map(data.assets.map((asset) => [asset.id, asset]));
    const asset = assets.get(assetId);
    if (!asset) return null;
    const source = data.sourceView;
    const roots = sourceRelations(source);
    const folderId = source.placements.find((item) => item.assetId === assetId)?.folderId;
    const folder = source.folders.find((item) => item.id === folderId);
    const batches = source.batches.filter((batch) => batch.assetIds.includes(assetId));
    const intakes = source.intakes.filter((item) => item.assetId === assetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const inputs = source.links.filter((link) => link.outputAssetIds.includes(assetId)
      || link.outputCollectionIds.some((id) => source.sequences.find((sequence) => sequence.id === id)?.assetIds.includes(assetId)));
    const parents = [...new Set(inputs.flatMap((link) => [...link.inputAssetIds,
      ...link.inputCollectionIds.flatMap((id) => source.sequences.find((sequence) => sequence.id === id)?.assetIds ?? [])]))]
      .map((id) => assets.get(id)).filter((item): item is AssetSummary => Boolean(item));
    const related = roots.related.get(assetId);
    return { asset, folder, batches, intakes, parents,
      children: related?.assetIds.map((id) => assets.get(id)).filter((item): item is AssetSummary => Boolean(item)) ?? [],
      sequences: related?.sequenceIds.map((id) => data.sequences.find((item) => item.id === id)).filter((item): item is AssetSequence => Boolean(item)) ?? [],
      origin: source.origins.find((item) => item.id === assetId) };
  }, [data, assetId]);
  const namedAsset = (asset: AssetSummary) => <li key={asset.id}><span>{asset.name}</span>
    {canvasAssetIds.has(asset.id) && onLocate ? <button className={styles.assetInfoLocate} type="button"
      onClick={() => { onLocate(asset.id); onClose(); }}>✦ 定位画布</button> : <small>未在画布</small>}</li>;
  return <div className={styles.assetInfoBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.assetInfoDialog} role="dialog" aria-modal="true" aria-label="素材信息">
      <header><strong>素材信息</strong><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      {error ? <p>{error}</p> : !info ? <p>正在读取素材信息…</p> : <>
        <h3>{info.asset.name}</h3><p>{info.asset.mimeType ?? info.asset.type} · {info.asset.width && info.asset.height ? `${info.asset.width} × ${info.asset.height} 像素` : "尺寸未知"}</p>
        <h4>目前位置</h4><p>{info.folder ? `${info.folder.category === "download" ? "下载" : "导入"} › ${info.folder.name}`
          : info.batches[0] ? `下载 › ${info.batches[0].name}`
            : sourceCategory(info.origin?.sourceType ?? "") === "download" ? "下载" : "导入"}</p>
        <h4>来源</h4><p>{({ line: "LINE 下载", bilibili: "B 站下载", local: "本地导入", "image-crop": "图片裁切",
          "frame-extraction": "动图拆帧", "frame-stitch": "图片拼接" } as Record<string, string>)[info.origin?.sourceType ?? ""] ?? "其他来源"}
          {info.batches.length ? ` · 批次：${info.batches.map((batch) => batch.name).join("、")}` : ""}
          {info.intakes[0]?.sourceName ? ` · 原始名称：${info.intakes[0].sourceName}` : ""}</p>
        {info.origin?.sourceUrl && /^https:\/\//.test(info.origin.sourceUrl) && <a href={info.origin.sourceUrl} target="_blank" rel="noopener noreferrer">打开来源</a>}
        {info.intakes.length > 0 && <details><summary>入库记录（{info.intakes.length}）</summary><ul>{info.intakes.map((item) => <li key={item.id}>
          <span>{item.sourceName} · {new Date(item.createdAt).toLocaleString("zh-CN")}</span></li>)}</ul></details>}
        {info.parents.length > 0 && <><h4>来源素材</h4><ul>{info.parents.map(namedAsset)}</ul></>}
        {info.children.length + info.sequences.length > 0 && <><h4>相关产物</h4><ul>{info.sequences.map((sequence) => <li key={sequence.id}>{sequence.name} · {sequence.frames.length} 帧</li>)}
          {info.children.map(namedAsset)}</ul></>}
      </>}
    </section>
  </div>;
}
