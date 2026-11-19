/* eslint-disable @next/next/no-img-element -- Crop previews use browser-generated data URLs and local source images. */
"use client";

import { useEffect, useState } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { cropOutputForItem, loadCropImage, renderCrop, type CropItem, type CropPlan } from "../image-crop";
import { CropEditor, CropSetup, useCropPreviews } from "../image-crop-ui";
import { useCanvasNodeActions } from "../node-actions-context";
import type { CanvasNode } from "../types";
import styles from "../image-crop.module.css";

export function CropResultNodeBody({ data, nodeId }: { data: { cropPlan?: CropPlan }; nodeId: string }) {
  const { getNode, setNodes } = useReactFlow<CanvasNode, Edge>();
  const { projectId, refreshAssets } = useCanvasNodeActions();
  const plan = data.cropPlan;
  const [editing, setEditing] = useState<number | null>(null);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!playing || !plan?.items.length) return;
    const timer = window.setTimeout(() => setFrame((current) => (current + 1) % plan.items.length), plan.items[frame]?.durationMs ?? 125);
    return () => window.clearTimeout(timer);
  }, [playing, frame, plan]);
  const previews = useCropPreviews(plan ?? { sourceAssetId: "", sourceUrl: "", sourceName: "", width: 1, height: 1,
    grids: [], items: [], ordered: false, output: { width: 1, height: 1, mode: "pad" } });
  const update = (next: CropPlan) => setNodes((nodes) => nodes.map((node) => node.id === nodeId && node.type === "module"
    ? { ...node, data: { ...node.data, cropPlan: { ...next, generatedAssetIds: undefined } } } : node));
  const generate = async () => {
    if (!plan || busy) return;
    setBusy(true); setError("");
    try {
      const images = await Promise.all((plan.sources ?? [{ url: plan.sourceUrl }]).map((source) => loadCropImage(source.url)));
      const files = await Promise.all(plan.items.map(async (item, index) => {
        const canvas = renderCrop(images[plan.sources ? index : 0], item, cropOutputForItem(plan, item));
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片编码失败")), "image/png"));
        return new File([blob], `${plan.sourceName.replace(/\.[^.]+$/, "")}-${String(index + 1).padStart(3, "0")}.png`, { type: "image/png" });
      }));
      const form = new FormData(); files.forEach((file) => form.append("files", file));
      form.append("cropSourceAssetIds", JSON.stringify(plan.sources?.map((source) => source.assetId) ?? plan.items.map(() => plan.sourceAssetId)));
      const response = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.assets) || !Array.isArray(body.importedIds)) throw new Error(body.error ?? "图片生成失败");
      const assets = (body.importedIds as string[]).map((id) => (body.assets as { id: string; previewUrl: string; name: string }[]).find((asset) => asset.id === id));
      if (assets.some((asset) => !asset)) throw new Error("生成的图片未能在资产库中找到");
      const parent = getNode(nodeId);
      if (!parent) throw new Error("裁切结果卡片已被移除，请从资产栏查看已生成的图片");
      const groupId = `crop-group-${crypto.randomUUID()}`;
      let sequenceId: string | undefined;
      if (plan.ordered) {
        const sequenceResponse = await fetch("/api/frame-extraction/ordered-sequences", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, groupId,
            name: `${plan.sourceName} 裁切序列`, frames: assets.map((asset, index) => ({ assetId: asset!.id, durationMs: plan.items[index].durationMs })) }) });
        const sequenceBody = await sequenceResponse.json();
        if (!sequenceResponse.ok) throw new Error(sequenceBody.error ?? "有序组保存失败；图片已加入资产库");
        sequenceId = sequenceBody.collectionId;
      }
      const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(assets.length))));
      const group: CanvasNode = { id: groupId, type: "group", position: { x: parent.position.x + 28, y: parent.position.y + 460 },
        style: { width: columns * 190 + 32, height: Math.ceil(assets.length / columns) * 184 + 56 },
        data: { label: `${plan.ordered ? "有序组" : "图片组"} · ${assets.length} 项`, sequenceId, ...(plan.ordered ? { orderedChildIds: assets.map((_, i) => `${groupId}-${i}`),
          frameDurationsMs: Object.fromEntries(plan.items.map((item, i) => [`${groupId}-${i}`, item.durationMs])) } : {}) } };
      const children: CanvasNode[] = assets.map((asset, i) => ({ id: `${groupId}-${i}`, type: "module", parentId: groupId,
        position: { x: 16 + i % columns * 190, y: 40 + Math.floor(i / columns) * 184 }, style: { width: 170, height: 150 },
        data: { moduleType: "image", assetId: asset!.id, previewUrl: asset!.previewUrl, title: asset!.name, naturalSizeApplied: true,
          derivationId: `${plan.sources?.[i]?.assetId ?? plan.sourceAssetId}:${plan.items[i].id}` } }));
      setNodes((nodes) => [...nodes.map((node) => node.id === nodeId && node.type === "module" ? { ...node,
        data: { ...node.data, cropPlan: { ...plan, generatedAssetIds: assets.map((asset) => asset!.id) } } } : node), group, ...children]);
      refreshAssets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片生成失败"); }
    finally { setBusy(false); }
  };
  if (!plan) return <div className={styles.result}>尚无裁切预览</div>;
  return <div className={`${styles.result} nodrag nopan nowheel`}>
    <header><strong>{plan.items.length} 张 · {plan.generatedAssetIds ? "已生成" : "未生成素材"}</strong><label><input checked={plan.ordered} onChange={(e) => update({ ...plan, ordered: e.target.checked })} type="checkbox" />设为有序组</label></header>
    <div className={styles.resultGrid}>{plan.items.map((item, index) => <div className={styles.resultItem} key={item.id}>
      {previews[index] ? <img alt={`裁切预览 ${index + 1}`} src={previews[index]} style={{ aspectRatio: `${cropOutputForItem(plan, item).width} / ${cropOutputForItem(plan, item).height}` }} />
        : <div className={styles.previewPending} style={{ aspectRatio: `${cropOutputForItem(plan, item).width} / ${cropOutputForItem(plan, item).height}` }}>正在生成预览…</div>}
      <footer><span>{String(index + 1).padStart(2, "0")}</span><button onClick={() => setEditing(index)} type="button">编辑</button></footer>
    </div>)}</div>
    {playing && previews[frame] && <div className={styles.resultItem}><img alt="播放预览" src={previews[frame]} style={{ aspectRatio: `${cropOutputForItem(plan, plan.items[frame]).width} / ${cropOutputForItem(plan, plan.items[frame]).height}` }} /></div>}
    <div className={styles.resultActions}>{!plan.sources && <button onClick={() => setSetup(true)}>调整网格</button>}<button onClick={() => setPlaying((current) => !current)}>{playing ? "暂停" : "播放预览"}</button><button disabled={busy || Boolean(plan.generatedAssetIds)} onClick={() => void generate()}>{busy ? "生成中…" : plan.generatedAssetIds ? "已生成" : "生成图片"}</button></div>
    {error && <p role="alert">{error}</p>}
    {editing !== null && <CropEditor index={editing} plan={plan} onClose={() => setEditing(null)} onSave={(items: CropItem[]) => { update({ ...plan, items }); setEditing(null); }} />}
    {setup && <CropSetup source={plan} onClose={() => setSetup(false)} onCreate={(next) => { update({ ...next, ordered: plan.ordered }); setSetup(false); }} />}
  </div>;
}
