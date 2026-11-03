import Image from "next/image";
import { Handle, NodeResizer, NodeToolbar, Position, useReactFlow, type Edge, type NodeProps } from "@xyflow/react";
import { Icon } from "@/app/components/app-icon";
import { getCanvasModule } from "../module-registry";
import type { CanvasModuleNode, CanvasPortDefinition } from "../types";
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

function ImageCanvasNode({ data, id, selected }: NodeProps<CanvasModuleNode>) {
  const { addNodes, deleteElements, getNode, updateNode } = useReactFlow<CanvasModuleNode, Edge>();

  const duplicate = () => {
    const node = getNode(id);
    if (!node) return;
    const copy = { ...node };
    delete copy.measured;
    delete copy.selected;
    addNodes({
      ...copy,
      id: `asset-${data.assetId ?? "image"}-${crypto.randomUUID()}`,
      position: { x: node.position.x + 28, y: node.position.y + 28 },
      data: { ...node.data },
      selected: false,
    });
  };

  const applyNaturalSize = (image: HTMLImageElement) => {
    if (data.naturalSizeApplied || !image.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(80, Math.round(image.naturalWidth * scale));
    const height = Math.max(80, Math.round(image.naturalHeight * scale));
    const node = getNode(id);
    updateNode(id, {
      data: { ...data, naturalSizeApplied: true },
      style: { ...node?.style, width, height },
    });
  };

  return (
    <article className={`${styles.imageCanvasNode} ${selected ? styles.imageCanvasNodeSelected : ""}`}>
      <NodeToolbar className={styles.imageToolbar} isVisible={selected} offset={14} position={Position.Top}>
        {data.previewUrl ? <a aria-label="下载图片" className="nodrag nopan" download={data.title ?? "image"} href={data.previewUrl} title="下载图片"><Icon name="download" /></a> : null}
        <button aria-label="复制图片" className="nodrag nopan" onClick={duplicate} title="复制图片" type="button"><Icon name="layers" /></button>
        <button aria-label="删除图片" className={`${styles.deleteImageAction} nodrag nopan`} onClick={() => void deleteElements({ nodes: [{ id }] })} title="删除图片" type="button"><Icon name="trash" /></button>
        <span className={styles.toolbarDivider} />
        <button aria-label="裁切图片（尚未接入）" className="nodrag nopan" disabled title="裁切功能将在后续接入" type="button"><Icon name="crop" /></button>
        <button aria-label="更多图片操作（尚未接入）" className="nodrag nopan" disabled title="更多图片操作将在后续接入" type="button"><Icon name="more" /></button>
      </NodeToolbar>
      <NodeResizer
        handleClassName={styles.imageResizeHandle}
        isVisible={selected}
        keepAspectRatio
        lineClassName={styles.imageResizeLine}
        minHeight={80}
        minWidth={80}
      />
      <div className={styles.imageCanvasMedia}>
        {data.previewUrl ? <Image alt={data.title ?? "画布图片"} fill loading="eager" onLoad={(event) => applyNaturalSize(event.currentTarget)} sizes="320px" src={data.previewUrl} unoptimized /> : <Icon name="image" />}
      </div>
      <PortHandles kind="source" ports={getCanvasModule("image").outputs} />
    </article>
  );
}

export function ModuleNode(props: NodeProps<CanvasModuleNode>) {
  const { data, selected } = props;
  if (data.moduleType === "image" && data.previewUrl) return <ImageCanvasNode {...props} />;
  const definition = getCanvasModule(data.moduleType);
  const { Body } = definition;

  return (
    <article
      className={`${styles.nodeCard} ${selected ? styles.nodeSelected : ""}`}
      style={{ width: definition.width }}
    >
      <PortHandles kind="target" ports={definition.inputs} />
      <header className={styles.nodeHeader}>
        <span className={`${styles.nodeHeaderIcon} ${definition.tone === "violet" ? styles.violetIcon : ""}`}>
          <Icon name={definition.icon} />
        </span>
        {definition.label}
        <button className="nodrag" aria-label={`${definition.label}更多操作`} type="button">
          <Icon name="more" />
        </button>
      </header>
      <Body data={data} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}
