"use client";

import Image from "next/image";
import { useProgressNavigation } from "@/components/navigation-progress";
import { VIDEO_ACCEPT } from "@/features/assets/video-policy";
import videoStyles from "../video.module.css";
import { CanvasVideoPlayer } from "../video-player";
import { useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, useReactFlow, useUpdateNodeInternals, type Edge, type NodeProps } from "@xyflow/react";
import { Icon } from "@/app/components/app-icon";
import { isOrderedGroup } from "../ordered-group";
import { getCanvasModule } from "../module-registry";
import { canvasModules, groupMaterialsPort, stitchResultPort } from "../module-metadata";
import { useCanvasNodeActions } from "../node-actions-context";
import { NodeQuickToolbar } from "../node-quick-toolbar";
import { GroupExportDialog } from "../group-export-dialog";
import { AssetInfoDialog } from "@/features/assets/asset-info-dialog";
import type { QuickAction } from "../quick-actions";
import { copyGroupActionLayout, defaultGroupActionLayout, groupActionIcons, groupActionLabel, type GroupActionId } from "../group-quick-actions";
import type { CanvasGroupNode, CanvasModuleNode, CanvasNode, CanvasPortDefinition } from "../types";
import styles from "../canvas.module.css";

function PortHandles({ ports, kind }: { ports: CanvasPortDefinition[]; kind: "source" | "target" }) {
  return ports.map((port, index) => (
    <Handle
      className={`${styles.port} ${kind === "target" ? styles.inputPort : styles.outputPort}`}
      id={port.id}
      key={port.id}
      position={kind === "target" ? Position.Left : Position.Right}
      style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
      title={`${port.label}${port.multiple ? "（支持多连接）" : ""}`}
      type={kind}
    />
  ));
}

type ImagePixelSize = { width: number; height: number };

function NodeInfo({ data, imageSize }: { data: CanvasModuleNode["data"]; imageSize?: ImagePixelSize }) {
  return (
    <span className={styles.nodeInfoPopover} role="status">
      <strong>{data.title ?? getCanvasModule(data.moduleType).label}</strong>
      {data.moduleType === "image" && data.previewUrl && <small>{imageSize
        ? `${imageSize.width} × ${imageSize.height} px` : "尺寸读取中…"}</small>}
      <small>{data.detail ?? (data.assetId ? `资产 ${data.assetId.slice(0, 8)}` : "当前为空节点")}</small>
    </span>
  );
}

function MaterialToolbar({ data, id, imageSize }: Pick<NodeProps<CanvasModuleNode>, "data" | "id"> & { imageSize?: ImagePixelSize }) {
  const navigate = useProgressNavigation();
  const [infoOpen, setInfoOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { deleteElements, getNode, getNodes, setNodes, fitView } = useReactFlow<CanvasNode, Edge>();
  const { importImage, importVideo, duplicateImage, openCropSetup, openVideoFrameExtraction, setFrameDuration, projectId } = useCanvasNodeActions();
  const node = getNode(id);
  const parent = node?.parentId ? getNode(node.parentId) : undefined;
  const orderedParent = isOrderedGroup(parent) ? parent : undefined;
  const durationInputRef = useRef<HTMLInputElement>(null);
  const filledImage = data.moduleType === "image" && Boolean(data.previewUrl);
  const canImport = data.moduleType === "image" || data.moduleType === "video";

  const definition = getCanvasModule(data.moduleType);
  const actions: QuickAction[] = [
    { id: "info", label: "查看节点信息", icon: "info", run: () => setInfoOpen((open) => !open) },
    ...(data.moduleType === "image" ? [
    { id: "download", label: "下载图片", icon: "download", visible: filledImage, href: data.previewUrl, download: data.title ?? "image" },
    { id: "duplicate", label: "复制图片", icon: "layers", visible: filledImage, run: () => duplicateImage(id) },
    ] satisfies QuickAction[] : []),
    { id: "delete", label: "删除节点", icon: "trash", danger: true, disabled: data.moduleType === "video-frame-extraction" && data.busy,
      run: () => { void deleteElements({ nodes: [{ id }] }); } },
    ...(data.moduleType === "video" ? [
      { id: "extract-frames", label: "逐帧导出", icon: "layers", visible: Boolean(data.assetId), defaultShowLabel: true,
        run: () => openVideoFrameExtraction(id) },
      { id: "export", label: data.clip ? "导出视频片段" : "导出视频", icon: "download", visible: Boolean(data.assetId),
        href: data.assetId ? data.clip
          ? `/api/projects/${encodeURIComponent(projectId)}/video-clips/${encodeURIComponent(data.assetId)}/export`
          : `/api/assets/${encodeURIComponent(data.assetId)}/content?download=1` : undefined },
      { id: "edit", label: "打开视频观察页", icon: "layout", visible: Boolean(data.assetId), defaultShowLabel: true,
        run: () => { if (data.assetId) navigate(`/video-editor/${encodeURIComponent(projectId)}/${encodeURIComponent(data.clip?.sourceAssetId ?? data.assetId)}${data.clip ? `?clip=${encodeURIComponent(data.assetId)}` : ""}`, "正在打开视频观察页"); } },
      { id: "import", label: data.previewUrl ? "替换视频" : "上传视频", icon: "video", disabled: data.busy,
        defaultShowLabel: true, run: () => inputRef.current?.click() },
    ] satisfies QuickAction[] : []),
    ...(data.moduleType === "image" ? [
    { id: "import", label: filledImage ? "替换图片" : "导入图片", icon: "upload", visible: canImport, disabled: data.busy, run: () => inputRef.current?.click() },
    { id: "crop", label: "裁切图片", icon: "crop", visible: filledImage, run: () => openCropSetup(id) },
    { id: "image-more", label: "其他图片功能（待确认）", icon: "more", visible: filledImage,
      disabled: true, defaultZone: "more", title: "其余图片功能等待后续讨论" },
    { id: "timing", label: "帧停留时间", icon: "play", visible: Boolean(orderedParent), defaultZone: "more",
      defaultShowLabel: true, run: () => setTimingOpen((open) => !open) },
    ] satisfies QuickAction[] : []),
  ];
  return (
    <>
      <NodeQuickToolbar kind={data.moduleType} typeLabel={definition.label} actions={actions}>
        {orderedParent && timingOpen && <div className={styles.nodeInfoPopover}><label className={`${styles.frameDurationControl} nodrag nopan`}>停留
          <input aria-label="帧停留毫秒" type="number" min={1} max={3600000} ref={durationInputRef}
            key={`${id}-${orderedParent.data.frameDurationsMs?.[id] ?? 100}`}
            defaultValue={orderedParent.data.frameDurationsMs?.[id] ?? 100}
            onBlur={(event) => { if (event.currentTarget.validity.valid) setFrameDuration(orderedParent.id, id, event.currentTarget.valueAsNumber); }} /> ms
          <button type="button" onClick={() => {
              const input = durationInputRef.current;
              if (input?.validity.valid) setFrameDuration(orderedParent.id, id, input.valueAsNumber, true);
            }}>应用到全组</button>
        </label></div>}
        {infoOpen && !data.assetId ? <NodeInfo data={data} imageSize={imageSize} /> : null}
      </NodeQuickToolbar>
      {infoOpen && data.assetId && <AssetInfoDialog projectId={projectId} assetId={data.assetId}
        canvasAssetIds={new Set(getNodes().flatMap((item) => "assetId" in item.data && typeof item.data.assetId === "string" ? [item.data.assetId] : []))}
        onLocate={(assetId) => { const matches = getNodes().filter((item) => "assetId" in item.data && item.data.assetId === assetId);
          if (matches.length) { const ids = new Set(matches.map((item) => item.id));
            setNodes((nodes) => nodes.map((item) => ({ ...item, selected: ids.has(item.id) })));
            void fitView({ nodes: matches, duration: 350, padding: .3 }); } }}
        onClose={() => setInfoOpen(false)} />}
      {canImport ? <input accept={data.moduleType === "video" ? VIDEO_ACCEPT : "image/png,image/jpeg,image/webp,image/gif"} hidden multiple={data.moduleType === "image"} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) { if (data.moduleType === "video") void importVideo(id, files[0]); else void importImage(id, files); } event.target.value = ""; }} ref={inputRef} type="file" /> : null}
    </>
  );
}

function MaterialResizer({ id, selected }: { id: string; selected: boolean }) {
  const { getNodes, setNodes } = useReactFlow<CanvasNode, Edge>();
  const resizeStart = useRef<{ sourceWidth: number; sourceHeight: number; peers: Map<string, { width: number; height: number }> } | null>(null);
  const syncPeers = (width: number, height: number) => {
    const start = resizeStart.current;
    if (!start || !start.peers.size) return;
    const ratio = Math.min(width / start.sourceWidth, height / start.sourceHeight);
    setNodes((nodes) => nodes.map((node) => {
      const size = start.peers.get(node.id);
      if (!size) return node;
      const nextWidth = Math.round(size.width * ratio);
      const nextHeight = Math.round(size.height * ratio);
      return { ...node, width: nextWidth, height: nextHeight, measured: { width: nextWidth, height: nextHeight },
        style: { ...node.style, width: nextWidth, height: nextHeight } };
    }));
  };
  return <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} keepAspectRatio lineClassName={styles.imageResizeLine} minHeight={80} minWidth={80}
    onResizeStart={() => {
      const images = getNodes().filter((node) => node.selected && node.type === "module" && node.data.moduleType === "image");
      const source = images.find((node) => node.id === id);
      if (!source || images.length < 2) { resizeStart.current = null; return; }
      const size = (node: CanvasNode) => ({ width: Number(node.style?.width ?? node.width ?? node.measured?.width ?? 320),
        height: Number(node.style?.height ?? node.height ?? node.measured?.height ?? 260) });
      const original = size(source);
      resizeStart.current = { sourceWidth: original.width, sourceHeight: original.height,
        peers: new Map(images.filter((node) => node.id !== id).map((node) => [node.id, size(node)])) };
    }}
    shouldResize={(_event, params) => {
      const start = resizeStart.current;
      if (!start) return true;
      const ratio = Math.min(params.width / start.sourceWidth, params.height / start.sourceHeight);
      return [...start.peers.values()].every((size) => size.width * ratio >= 80 && size.height * ratio >= 80);
    }}
    onResize={(_event, params) => syncPeers(params.width, params.height)}
    onResizeEnd={(_event, params) => { syncPeers(params.width, params.height); resizeStart.current = null; }} />;
}

function ImageCanvasNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const { getNode, updateNode } = useReactFlow<CanvasNode, Edge>();
  const [loadedSize, setLoadedSize] = useState<(ImagePixelSize & { source: string }) | null>(null);
  const definition = getCanvasModule("image");
  const node = getNode(id);
  const parent = node?.parentId ? getNode(node.parentId) : undefined;
  const frameIndex = parent?.type === "group" ? parent.data.orderedChildIds?.indexOf(id) : undefined;
  const inOrderedGroup = isOrderedGroup(parent);

  const applyNaturalSize = (image: HTMLImageElement) => {
    if (data.previewUrl && image.naturalWidth && image.naturalHeight) {
      const size = { source: data.previewUrl, width: image.naturalWidth, height: image.naturalHeight };
      setLoadedSize((previous) => previous?.source === size.source && previous.width === size.width
        && previous.height === size.height ? previous : size);
    }
    if (data.naturalSizeApplied || !image.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(80, Math.round(image.naturalWidth * scale));
    const height = Math.max(80, Math.round(image.naturalHeight * scale));
    const node = getNode(id);
    updateNode(id, { data: { ...data, naturalSizeApplied: true, statusMessage: undefined }, style: { ...node?.style, width, height } });
  };

  return (
    <article className={`${styles.materialNode} ${styles.imageCanvasNode} ${selected ? styles.imageCanvasNodeSelected : ""}`}>
      <span className={styles.materialNodeLabel}>图片</span>
      {frameIndex !== undefined && frameIndex >= 0 && <span className={styles.frameNumber}>{String(frameIndex + 1).padStart(2, "0")}</span>}
      <MaterialToolbar data={data} id={id} imageSize={loadedSize && loadedSize.source === data.previewUrl ? loadedSize : undefined} />
      <MaterialResizer id={id} selected={selected && !inOrderedGroup} />
      <div className={`${styles.imageCanvasMedia} ${!data.previewUrl ? styles.emptyMaterialMedia : ""}`}>
        {data.previewUrl ? <Image alt={data.title ?? "画布图片"} fill loading="eager" onLoad={(event) => applyNaturalSize(event.currentTarget)} sizes="320px" src={data.previewUrl} unoptimized /> : <><span className={styles.emptyMaterialIcon}><Icon name="image" /></span><span>{data.busy ? "正在导入图片…" : data.statusMessage ?? "空图片节点"}</span></>}
      </div>
      <PortHandles kind="target" ports={definition.inputs} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}

function TextCanvasNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const [editing, setEditing] = useState(false);
  const { updateNodeData } = useCanvasNodeActions();
  const definition = getCanvasModule("text");
  return (
    <article className={`${styles.materialNode} ${styles.textCanvasNode} ${selected ? styles.materialNodeSelected : ""}`} onDoubleClick={() => setEditing(true)}>
      <span className={styles.materialNodeLabel}>文本</span>
      <MaterialToolbar data={data} id={id} />
      <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} lineClassName={styles.imageResizeLine} minHeight={120} minWidth={180} />
      {editing ? (
        <textarea autoFocus className={`${styles.textNodeEditor} nodrag nopan nowheel`} onBlur={() => setEditing(false)} onChange={(event) => updateNodeData(id, { textContent: event.target.value })} value={data.textContent ?? ""} />
      ) : <p className={styles.textNodeContent}>{data.textContent || "双击编辑文字"}</p>}
      <PortHandles kind="target" ports={definition.inputs} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}

function VideoCanvasNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const definition = getCanvasModule("video");
  return <article className={`${styles.materialNode} ${styles.emptyMediaNode} ${selected ? styles.materialNodeSelected : ""}`}>
    <span className={styles.materialNodeLabel}>视频</span>
    <MaterialToolbar data={data} id={id} />
    <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} keepAspectRatio lineClassName={styles.imageResizeLine} minHeight={100} minWidth={180} />
    {data.previewUrl ? <CanvasVideoPlayer key={`${data.previewUrl}:${data.assetId}`} source={data.previewUrl} title={data.title ?? "画布视频"} clip={data.clip} />
      : <div className={videoStyles.empty}>
        <Icon name="video" /><strong>{data.busy ? "正在导入视频…" : "空视频节点"}</strong>
        <small>选中后，点击上方工具栏的「上传视频」</small>
      </div>}
    <PortHandles kind="target" ports={definition.inputs} /><PortHandles kind="source" ports={definition.outputs} />
  </article>;
}

function EmptyMediaNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const definition = getCanvasModule(data.moduleType);
  return (
    <article className={`${styles.materialNode} ${styles.emptyMediaNode} ${selected ? styles.materialNodeSelected : ""}`}>
      <span className={styles.materialNodeLabel}>{definition.label}</span>
      <MaterialToolbar data={data} id={id} />
      <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} keepAspectRatio lineClassName={styles.imageResizeLine} minHeight={80} minWidth={160} />
      <span className={styles.emptyMaterialIcon}><Icon name={definition.icon} /></span>
      <span>{definition.label}导入将在后续接入</span>
      <PortHandles kind="target" ports={definition.inputs} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}

export function GroupNode({ data, id, selected }: NodeProps<CanvasGroupNode>) {
  const { deleteElements } = useReactFlow<CanvasNode, Edge>();
  const { arrangeGroup, copyFrameGroup, finishGroupResize, groupContentScaleEnabled, groupCovers, groupMembers, groupExportManifest, openBatchEditor, previewOrderedGroup, projectId, setGroupOrdered, toggleGroup, toggleGroupContentScale, ungroupNode } = useCanvasNodeActions();
  const [arranging, setArranging] = useState(false);
  const [arrangeError, setArrangeError] = useState("");
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const updateInternals = useUpdateNodeInternals();
  const cover = groupCovers.get(id);
  const collapsed = Boolean(data.collapsed);
  const isBatch = Boolean(data.frameTask);
  const isSequence = Boolean(data.frameSourceId);
  const members = groupMembers(id);
  const orderedMembers = data.orderedChildIds?.flatMap((memberId) => {
    const member = members.find((item) => item.id === memberId);
    return member ? [member] : [];
  }) ?? [];
  useEffect(() => { updateInternals(id); }, [collapsed, id, updateInternals]);
  const runAction = (action: GroupActionId) => {
    switch (action) {
      case "arrange":
        setArranging(true); setArrangeError("");
        void arrangeGroup(id).catch((error: unknown) => setArrangeError(error instanceof Error ? error.message : "整理失败，请重试"))
          .finally(() => setArranging(false));
        break;
      case "preview": previewOrderedGroup(id); break;
      case "toggle-collapse": toggleGroup(id); break;
      case "ungroup": ungroupNode(id); break;
      case "delete": void deleteElements({ nodes: [{ id }] }); break;
      case "toggle-order": void setGroupOrdered(id); break;
      case "toggle-scale": toggleGroupContentScale(); break;
      case "export": setExportOpen(true); break;
    }
  };
  const normalActions: QuickAction[] = [...defaultGroupActionLayout.toolbar, ...defaultGroupActionLayout.more].map((action) => ({
    id: action, label: groupActionLabel(action, collapsed, data.orderedChildIds !== undefined), icon: groupActionIcons[action],
    defaultZone: defaultGroupActionLayout.more.includes(action) ? "more" : "toolbar",
    defaultShowLabel: action !== "ungroup" && action !== "delete",
    visible: (action !== "arrange" || !collapsed) && (action !== "preview" || orderedMembers.length > 0),
    disabled: action === "arrange" && arranging, danger: action === "delete",
    pressed: action === "toggle-scale" ? groupContentScaleEnabled : undefined, run: () => runAction(action),
  }));
  const specialActions: QuickAction[] = [
    { id: "copy-frames", label: copying ? "复制中…" : "复制到画布", icon: "layers", defaultShowLabel: true, visible: isSequence, disabled: copying,
      run: () => {
        setCopying(true); setCopyError("");
        void copyFrameGroup(id).catch((error: unknown) => setCopyError(error instanceof Error ? error.message : "复制失败"))
          .finally(() => setCopying(false));
      } },
    { id: "toggle-collapse", label: collapsed ? "展开组" : "折叠组", icon: "layers", defaultShowLabel: true, run: () => toggleGroup(id) },
    { id: "delete", label: "删除组及画布实例", icon: "trash", visible: isBatch, danger: true,
      run: () => { void deleteElements({ nodes: [{ id }] }); } },
  ];
  const exportManifest = exportOpen ? groupExportManifest(id) : undefined;
  const defaultExportName = data.label && !/^(组|有序组)(\s*·\s*\d+\s*项)?$/.test(data.label)
    ? data.label : `${data.orderedChildIds ? "有序组" : "普通组"}-${groupCovers.get(id)?.count ?? members.length}项`;
  return (
    <>
    {exportManifest && <GroupExportDialog entries={exportManifest.entries} initialName={defaultExportName} onClose={() => setExportOpen(false)} projectId={projectId} skipped={exportManifest.skipped} />}
    <section key={collapsed ? "collapsed" : "expanded"} className={`${styles.groupNode} ${selected ? styles.groupNodeSelected : ""} ${collapsed ? styles.collapsedGroup : styles.expandedGroup}`}>
      <NodeQuickToolbar kind={isBatch ? "animation-batch-group" : isSequence ? "frame-sequence-group" : "group"}
        typeLabel={isBatch ? "动画帧批次" : isSequence ? "序列帧组" : "组"}
        actions={isBatch || isSequence ? specialActions.filter((action) => isSequence ? action.id !== "delete" : action.id !== "copy-frames") : normalActions}
        legacyLayout={!isBatch && !isSequence && data.quickActionLayout ? copyGroupActionLayout(data.quickActionLayout) : undefined}>
        {arrangeError && <span className={styles.nodeInfoPopover} role="alert">{arrangeError}</span>}
        {copyError && <span className={styles.nodeInfoPopover} role="alert">{copyError}</span>}
      </NodeQuickToolbar>
      {!collapsed && !isBatch && !isSequence && <NodeResizer handleClassName={styles.groupResizeHandle} isVisible={selected} lineClassName={styles.groupResizeLine} minHeight={180} minWidth={260} onResize={data.orderedChildIds ? (_event, size) => finishGroupResize(id, size.width, size.height) : undefined} onResizeEnd={(_event, size) => finishGroupResize(id, size.width, size.height)} />}
      {collapsed ? <>
        <div className={styles.groupCover}>
          {cover?.preview ? <Image alt="" fill sizes="136px" src={cover.preview} unoptimized /> : <Icon name="group" />}
        </div>
        <div className={styles.groupCoverLabel}><strong title={data.label}>{data.label}</strong><small>{cover?.count ?? 0} {isSequence ? (data.frameSaved ? "帧 · 已保存" : "帧 · 草稿") : data.orderedChildIds ? "项 · 有序" : "项"}</small></div>
        <Handle id="collapsed-input" type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, pointerEvents: "none" }} />
      </> : <span>{data.label}{data.orderedChildIds ? " · 有序" : ""}</span>}
      {isBatch ? <>
        <PortHandles kind="target" ports={canvasModules["frame-batch"].inputs} />
        <PortHandles kind="source" ports={canvasModules["frame-batch"].outputs} />
        <div className={styles.batchLaunchers}>
          <button className={`${styles.batchEditorLauncher} nodrag nopan`} type="button" onClick={() => openBatchEditor(id)}>
            <Icon name="layers" />动画帧编辑
          </button>
          <button className={`${styles.batchEditorLauncher} nodrag nopan`} type="button" onClick={() => openBatchEditor(id, "frame-stitch")}>
            <Icon name="grid" />动画帧拼接
          </button>
        </div>
      </> : <>
        {data.stitchResult && <PortHandles kind="target" ports={[stitchResultPort]} />}
        <PortHandles kind="source" ports={isSequence ? canvasModules["frame-result"].outputs : [groupMaterialsPort]} />
      </>}
    </section>
    </>
  );
}

export function ModuleNode(props: NodeProps<CanvasModuleNode>) {
  const { data, selected } = props;
  if (data.moduleType === "image") return <ImageCanvasNode {...props} />;
  if (data.moduleType === "text") return <TextCanvasNode {...props} />;
  if (data.moduleType === "video") return <VideoCanvasNode {...props} />;
  if (data.moduleType === "audio") return <EmptyMediaNode {...props} />;
  const definition = getCanvasModule(data.moduleType);
  const { Body } = definition;

  return (
    <article className={`${styles.nodeCard} ${selected ? styles.nodeSelected : ""} ${data.moduleType === "frame-batch" ? styles.frameBatchCard : ""}`} style={{ width: definition.width }}>
      <MaterialToolbar data={data} id={props.id} />
      <PortHandles kind="target" ports={definition.inputs} />
      <header className={styles.nodeHeader}>
        <span className={`${styles.nodeHeaderIcon} ${definition.tone === "violet" ? styles.violetIcon : ""}`}><Icon name={definition.icon} /></span>
        {definition.label}
      </header>
      {Body ? <Body data={data} nodeId={props.id} /> : null}
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}
