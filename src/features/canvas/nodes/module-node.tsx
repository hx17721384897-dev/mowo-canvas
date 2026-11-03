"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Handle, NodeResizer, NodeToolbar, Position, useReactFlow, type Edge, type NodeProps } from "@xyflow/react";
import { Icon } from "@/app/components/app-icon";
import { getCanvasModule } from "../module-registry";
import { useCanvasNodeActions } from "../node-actions-context";
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

function NodeInfo({ data }: { data: CanvasModuleNode["data"] }) {
  return (
    <span className={styles.nodeInfoPopover} role="status">
      <strong>{data.title ?? getCanvasModule(data.moduleType).label}</strong>
      <small>{data.detail ?? (data.assetId ? `资产 ${data.assetId.slice(0, 8)}` : "当前为空节点")}</small>
    </span>
  );
}

function MaterialToolbar({ data, id, selected }: Pick<NodeProps<CanvasModuleNode>, "data" | "id" | "selected">) {
  const [infoOpen, setInfoOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addNodes, deleteElements, getNode } = useReactFlow<CanvasNode, Edge>();
  const { importImage } = useCanvasNodeActions();
  const filledImage = data.moduleType === "image" && Boolean(data.previewUrl);
  const canImport = data.moduleType === "image";

  const duplicate = () => {
    const node = getNode(id);
    if (!node || node.type !== "module") return;
    const copy = { ...node };
    delete copy.measured;
    delete copy.selected;
    addNodes({
      ...copy,
      id: `material-${data.moduleType}-${crypto.randomUUID()}`,
      position: { x: node.position.x + 28, y: node.position.y + 28 },
      data: { ...node.data },
      selected: false,
    });
  };

  return (
    <>
      <NodeToolbar className={styles.imageToolbar} isVisible={selected} offset={14} position={Position.Top}>
        <button aria-label="查看节点信息" className="nodrag nopan" onClick={() => setInfoOpen((open) => !open)} title="查看节点信息" type="button"><Icon name="info" /></button>
        {filledImage && data.previewUrl ? <a aria-label="下载图片" className="nodrag nopan" download={data.title ?? "image"} href={data.previewUrl} title="下载图片"><Icon name="download" /></a> : null}
        {filledImage ? <button aria-label="复制图片" className="nodrag nopan" onClick={duplicate} title="复制图片" type="button"><Icon name="layers" /></button> : null}
        <button aria-label="删除节点" className={`${styles.deleteImageAction} nodrag nopan`} onClick={() => void deleteElements({ nodes: [{ id }] })} title="删除节点" type="button"><Icon name="trash" /></button>
        {canImport ? <button aria-label={filledImage ? "替换图片" : "导入图片"} className="nodrag nopan" disabled={data.busy} onClick={() => inputRef.current?.click()} title={filledImage ? "替换图片" : "从本地导入图片"} type="button"><Icon name="upload" /></button> : null}
        {filledImage ? <><span className={styles.toolbarDivider} /><button aria-label="裁切图片（尚未接入）" className="nodrag nopan" disabled title="裁切功能将在后续接入" type="button"><Icon name="crop" /></button><button aria-label="其他图片功能（待确认）" className="nodrag nopan" disabled title="其余图片功能等待后续讨论" type="button"><Icon name="more" /></button></> : null}
        {infoOpen ? <NodeInfo data={data} /> : null}
      </NodeToolbar>
      {canImport ? <input accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importImage(id, file); event.target.value = ""; }} ref={inputRef} type="file" /> : null}
    </>
  );
}

function MaterialResizer({ selected }: { selected: boolean }) {
  return <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} keepAspectRatio lineClassName={styles.imageResizeLine} minHeight={80} minWidth={80} />;
}

function ImageCanvasNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const { getNode, updateNode } = useReactFlow<CanvasNode, Edge>();
  const definition = getCanvasModule("image");

  const applyNaturalSize = (image: HTMLImageElement) => {
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
      <MaterialToolbar data={data} id={id} selected={selected} />
      <MaterialResizer selected={selected} />
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
      <MaterialToolbar data={data} id={id} selected={selected} />
      <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} lineClassName={styles.imageResizeLine} minHeight={120} minWidth={180} />
      {editing ? (
        <textarea autoFocus className={`${styles.textNodeEditor} nodrag nopan nowheel`} onBlur={() => setEditing(false)} onChange={(event) => updateNodeData(id, { textContent: event.target.value })} value={data.textContent ?? ""} />
      ) : <p className={styles.textNodeContent}>{data.textContent || "双击编辑文字"}</p>}
      <PortHandles kind="target" ports={definition.inputs} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}

function EmptyMediaNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const definition = getCanvasModule(data.moduleType);
  return (
    <article className={`${styles.materialNode} ${styles.emptyMediaNode} ${selected ? styles.materialNodeSelected : ""}`}>
      <span className={styles.materialNodeLabel}>{definition.label}</span>
      <MaterialToolbar data={data} id={id} selected={selected} />
      <NodeResizer handleClassName={styles.imageResizeHandle} isVisible={selected} keepAspectRatio lineClassName={styles.imageResizeLine} minHeight={80} minWidth={160} />
      <span className={styles.emptyMaterialIcon}><Icon name={definition.icon} /></span>
      <span>{definition.label}导入将在后续接入</span>
      <PortHandles kind="target" ports={definition.inputs} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}

export function GroupNode({ data, selected }: NodeProps<CanvasGroupNode>) {
  return (
    <section className={`${styles.groupNode} ${selected ? styles.groupNodeSelected : ""}`}>
      <NodeResizer handleClassName={styles.groupResizeHandle} isVisible={selected} lineClassName={styles.groupResizeLine} minHeight={180} minWidth={260} />
      <span>{data.label}</span>
    </section>
  );
}

export function ModuleNode(props: NodeProps<CanvasModuleNode>) {
  const { data, selected } = props;
  if (data.moduleType === "image") return <ImageCanvasNode {...props} />;
  if (data.moduleType === "text") return <TextCanvasNode {...props} />;
  if (data.moduleType === "video" || data.moduleType === "audio") return <EmptyMediaNode {...props} />;
  const definition = getCanvasModule(data.moduleType);
  const { Body } = definition;

  return (
    <article className={`${styles.nodeCard} ${selected ? styles.nodeSelected : ""}`} style={{ width: definition.width }}>
      <PortHandles kind="target" ports={definition.inputs} />
      <header className={styles.nodeHeader}>
        <span className={`${styles.nodeHeaderIcon} ${definition.tone === "violet" ? styles.violetIcon : ""}`}><Icon name={definition.icon} /></span>
        {definition.label}
        <button className="nodrag" aria-label={`${definition.label}更多操作`} type="button"><Icon name="more" /></button>
      </header>
      {Body ? <Body data={data} /> : null}
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}
