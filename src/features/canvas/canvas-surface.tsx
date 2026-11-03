"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { getCanvasModule } from "./module-registry";
import { ASSET_DRAG_TYPE, type AssetSummary } from "@/features/assets/types";
import { ModuleNode } from "./nodes/module-node";
import type { CanvasModuleNode } from "./types";
import type { CanvasDocumentState } from "@/features/projects/types";
import styles from "./canvas.module.css";

const nodeTypes = { module: ModuleNode };

const initialNodes: CanvasModuleNode[] = [
  {
    id: "image-1",
    type: "module",
    position: { x: 80, y: 95 },
    data: { moduleType: "image", title: "表情图集-01.png", detail: "2048 × 2048 · 3.2 MB", variant: "warm" },
  },
  {
    id: "image-2",
    type: "module",
    position: { x: 80, y: 260 },
    data: { moduleType: "image", title: "表情图集-02.png", detail: "2048 × 2048 · 2.8 MB", variant: "cool" },
  },
  {
    id: "crop-1",
    type: "module",
    position: { x: 410, y: 150 },
    data: { moduleType: "batch-crop" },
  },
];

const initialEdges: Edge[] = [
  { id: "image-1-crop", source: "image-1", sourceHandle: "image", target: "crop-1", targetHandle: "source-images", type: "smoothstep" },
  { id: "image-2-crop", source: "image-2", sourceHandle: "image", target: "crop-1", targetHandle: "source-images", type: "smoothstep" },
];

function findPort(node: CanvasModuleNode | undefined, handleId: string | null | undefined, side: "inputs" | "outputs") {
  if (!node || !handleId) return undefined;
  return getCanvasModule(node.data.moduleType)[side].find((port) => port.id === handleId);
}

export function CanvasSurface({ initialDocument, onAssetIdsChange, onDocumentChange }: {
  initialDocument: CanvasDocumentState | null;
  onAssetIdsChange: (assetIds: string[]) => void;
  onDocumentChange: (document: CanvasDocumentState) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasModuleNode>(initialDocument?.nodes ?? initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialDocument?.edges ?? initialEdges);
  const [viewport, setViewport] = useState<Viewport>(initialDocument?.viewport ?? { x: 0, y: 0, zoom: 1 });
  const flowRef = useRef<ReactFlowInstance<CanvasModuleNode, Edge> | null>(null);
  const assetIdSignature = [...new Set(nodes.flatMap((node) => node.data.assetId ? [node.data.assetId] : []))].sort().join("\n");

  useEffect(() => {
    onAssetIdsChange(assetIdSignature ? assetIdSignature.split("\n") : []);
  }, [assetIdSignature, onAssetIdsChange]);

  useEffect(() => {
    const persistentNodes = nodes.map((node) => {
      const persistent = { ...node };
      delete persistent.dragging;
      delete persistent.measured;
      delete persistent.resizing;
      delete persistent.selected;
      return persistent;
    });
    const persistentEdges = edges.map((edge) => {
      const persistent = { ...edge };
      delete persistent.selected;
      return persistent;
    });
    onDocumentChange({ schemaVersion: 1, nodes: persistentNodes, edges: persistentEdges, viewport });
  }, [edges, nodes, onDocumentChange, viewport]);

  const isValidConnection: IsValidConnection<Edge> = useCallback((connection) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    const sourcePort = findPort(sourceNode, connection.sourceHandle, "outputs");
    const targetPort = findPort(targetNode, connection.targetHandle, "inputs");

    if (!sourcePort || !targetPort || sourcePort.contentType !== targetPort.contentType) return false;
    if (targetPort.multiple) return true;

    return !edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle);
  }, [edges, nodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge({ ...connection, type: "smoothstep" }, currentEdges));
  }, [setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    const serialized = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!serialized || !flowRef.current) return;
    event.preventDefault();

    try {
      const asset = JSON.parse(serialized) as AssetSummary;
      if (asset.type !== "image") return;
      const position = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setNodes((current) => current.concat({
        id: `asset-${asset.id}-${crypto.randomUUID()}`,
        type: "module",
        position,
        style: { width: 240, height: 190 },
        data: {
          moduleType: "image",
          assetId: asset.id,
          previewUrl: asset.previewUrl ?? undefined,
          title: asset.name,
          detail: asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · 资产库` : "资产库",
        },
      }));
    } catch {
      // Ignore malformed external drag data.
    }
  }, [setNodes]);

  return (
    <div className={styles.surface}>
      <ReactFlow<CanvasModuleNode, Edge>
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
        onInit={(instance) => { flowRef.current = instance; }}
        isValidConnection={isValidConnection}
        deleteKeyCode={["Backspace", "Delete"]}
        defaultViewport={viewport}
        fitView={!initialDocument}
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        selectionOnDrag
        panOnDrag={[1, 2]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#d9dce6" />
        <Controls className={styles.controls} showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
