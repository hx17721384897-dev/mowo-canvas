"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeChange,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { ASSET_DRAG_TYPE, type AssetSummary } from "@/features/assets/types";
import type { CanvasDocumentState } from "@/features/projects/types";
import { getCanvasModule } from "./module-registry";
import { CanvasNodeActionsProvider } from "./node-actions-context";
import { GroupNode, ModuleNode } from "./nodes/module-node";
import type { CanvasModuleData, CanvasModuleNode, CanvasNode } from "./types";
import styles from "./canvas.module.css";

export type CanvasInteractionMode = "pan" | "select";
export type CanvasInsertType = "audio" | "group" | "image" | "text" | "video";
export type CanvasSurfaceHandle = {
  addNode: (type: CanvasInsertType) => void;
  redo: () => void;
  undo: () => void;
};

type CanvasSurfaceProps = {
  initialDocument: CanvasDocumentState | null;
  interactionMode: CanvasInteractionMode;
  onAssetIdsChange: (assetIds: string[]) => void;
  onAssetImported: () => void;
  onDocumentChange: (document: CanvasDocumentState) => void;
  onHistoryChange: (state: { canRedo: boolean; canUndo: boolean }) => void;
  projectId: string;
};

type HistorySnapshot = { edges: Edge[]; nodes: CanvasNode[] };

const nodeTypes = { group: GroupNode, module: ModuleNode };

const initialNodes: CanvasNode[] = [
  {
    id: "image-1",
    type: "module",
    position: { x: 80, y: 95 },
    style: { height: 170, width: 210 },
    data: { moduleType: "image", title: "表情图集-01.png", detail: "2048 × 2048 · 3.2 MB", variant: "warm" },
  },
  {
    id: "image-2",
    type: "module",
    position: { x: 80, y: 300 },
    style: { height: 170, width: 210 },
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

function persistentNodes(nodes: CanvasNode[]) {
  return nodes.map((node) => {
    const persistent = { ...node };
    delete persistent.dragging;
    delete persistent.measured;
    delete persistent.resizing;
    delete persistent.selected;
    return persistent;
  });
}

function persistentEdges(edges: Edge[]) {
  return edges.map((edge) => {
    const persistent = { ...edge };
    delete persistent.selected;
    return persistent;
  });
}

function createSnapshot(nodes: CanvasNode[], edges: Edge[]): HistorySnapshot {
  return structuredClone({ nodes: persistentNodes(nodes), edges: persistentEdges(edges) });
}

function snapshotSignature(snapshot: HistorySnapshot) {
  return JSON.stringify(snapshot);
}

function parentsFirst(nodes: CanvasNode[]) {
  return [...nodes].sort((left, right) => Number(right.type === "group") - Number(left.type === "group"));
}

function isModuleNode(node: CanvasNode | undefined): node is CanvasModuleNode {
  return node?.type === "module";
}

function findPort(node: CanvasNode | undefined, handleId: string | null | undefined, side: "inputs" | "outputs") {
  if (!isModuleNode(node) || !handleId) return undefined;
  return getCanvasModule(node.data.moduleType)[side].find((port) => port.id === handleId);
}

function groupAtPoint(nodes: CanvasNode[], point: { x: number; y: number }) {
  return nodes.find((node) => {
    if (node.type !== "group") return false;
    const width = node.measured?.width ?? Number(node.style?.width ?? 0);
    const height = node.measured?.height ?? Number(node.style?.height ?? 0);
    return point.x >= node.position.x && point.x <= node.position.x + width && point.y >= node.position.y && point.y <= node.position.y + height;
  });
}

function materialNode(type: Exclude<CanvasInsertType, "group">, position: { x: number; y: number }): CanvasModuleNode {
  const sizes: Record<typeof type, { height: number; width: number }> = {
    audio: { height: 120, width: 280 },
    image: { height: 220, width: 260 },
    text: { height: 200, width: 300 },
    video: { height: 180, width: 280 },
  };
  return {
    id: `material-${type}-${crypto.randomUUID()}`,
    type: "module",
    position,
    selected: true,
    style: sizes[type],
    data: { moduleType: type, textContent: type === "text" ? "" : undefined },
  };
}

export const CanvasSurface = forwardRef<CanvasSurfaceHandle, CanvasSurfaceProps>(function CanvasSurface({
  initialDocument,
  interactionMode,
  onAssetIdsChange,
  onAssetImported,
  onDocumentChange,
  onHistoryChange,
  projectId,
}, ref) {
  const startingNodes = initialDocument?.nodes ?? initialNodes;
  const startingEdges = initialDocument?.edges ?? initialEdges;
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(startingNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(startingEdges);
  const [viewport, setViewport] = useState<Viewport>(initialDocument?.viewport ?? { x: 0, y: 0, zoom: 1 });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const insertionIndexRef = useRef(0);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapshotRef = useRef<HistorySnapshot | null>(null);
  const historyRef = useRef({ current: createSnapshot(startingNodes, startingEdges), future: [] as HistorySnapshot[], past: [] as HistorySnapshot[] });
  const assetIdSignature = [...new Set(nodes.flatMap((node) => isModuleNode(node) && node.data.assetId ? [node.data.assetId] : []))].sort().join("\n");

  const publishHistory = useCallback(() => {
    onHistoryChange({ canRedo: historyRef.current.future.length > 0, canUndo: historyRef.current.past.length > 0 });
  }, [onHistoryChange]);

  const commitPendingHistory = useCallback(() => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    const pending = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    if (!pending || snapshotSignature(pending) === snapshotSignature(historyRef.current.current)) return;
    historyRef.current.past.push(historyRef.current.current);
    if (historyRef.current.past.length > 80) historyRef.current.past.shift();
    historyRef.current.current = pending;
    historyRef.current.future = [];
    publishHistory();
  }, [publishHistory]);

  useEffect(() => {
    const snapshot = createSnapshot(nodes, edges);
    if (snapshotSignature(snapshot) === snapshotSignature(historyRef.current.current)) return;
    pendingSnapshotRef.current = snapshot;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(commitPendingHistory, 280);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [commitPendingHistory, edges, nodes]);

  useEffect(() => {
    onAssetIdsChange(assetIdSignature ? assetIdSignature.split("\n") : []);
  }, [assetIdSignature, onAssetIdsChange]);

  useEffect(() => {
    onDocumentChange({ schemaVersion: 1, nodes: persistentNodes(nodes), edges: persistentEdges(edges), viewport });
  }, [edges, nodes, onDocumentChange, viewport]);

  const applySnapshot = useCallback((snapshot: HistorySnapshot) => {
    pendingSnapshotRef.current = null;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    setNodes(structuredClone(snapshot.nodes));
    setEdges(structuredClone(snapshot.edges));
  }, [setEdges, setNodes]);

  const undo = useCallback(() => {
    commitPendingHistory();
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.unshift(historyRef.current.current);
    historyRef.current.current = previous;
    applySnapshot(previous);
    publishHistory();
  }, [applySnapshot, commitPendingHistory, publishHistory]);

  const redo = useCallback(() => {
    commitPendingHistory();
    const next = historyRef.current.future.shift();
    if (!next) return;
    historyRef.current.past.push(historyRef.current.current);
    historyRef.current.current = next;
    applySnapshot(next);
    publishHistory();
  }, [applySnapshot, commitPendingHistory, publishHistory]);

  const addNode = useCallback((type: CanvasInsertType) => {
    commitPendingHistory();
    const instance = flowRef.current;
    const surface = surfaceRef.current;
    if (!instance || !surface) return;
    const bounds = surface.getBoundingClientRect();
    const center = instance.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    const offset = (insertionIndexRef.current++ % 6) * 24;
    setNodes((current) => {
      const deselected: CanvasNode[] = current.map((node) => ({ ...node, selected: false }));
      if (type === "group") {
        return parentsFirst(deselected.concat({
          id: `group-${crypto.randomUUID()}`,
          type: "group",
          position: { x: center.x - 220 + offset, y: center.y - 150 + offset },
          selected: true,
          style: { height: 300, width: 440 },
          data: { label: "组" },
        }));
      }
      const node = materialNode(type, { x: center.x - 130 + offset, y: center.y - 100 + offset });
      return [...deselected, node];
    });
  }, [commitPendingHistory, setNodes]);

  useImperativeHandle(ref, () => ({ addNode, redo, undo }), [addNode, redo, undo]);

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

  const updateNodeData = useCallback((nodeId: string, data: Partial<CanvasModuleData>) => {
    setNodes((current) => current.map((node) => node.id === nodeId && isModuleNode(node) ? { ...node, data: { ...node.data, ...data } } : node));
  }, [setNodes]);

  const importImage = useCallback(async (nodeId: string, file: File) => {
    updateNodeData(nodeId, { busy: true, statusMessage: undefined });
    try {
      const formData = new FormData();
      formData.append("files", file);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body: formData });
      const payload = await response.json() as { assets?: AssetSummary[]; importedIds?: string[]; error?: string };
      if (!response.ok || !payload.assets?.length) throw new Error(payload.error ?? "导入图片失败");
      const assetId = payload.importedIds?.[0];
      const asset = payload.assets.find((item) => item.id === assetId) ?? payload.assets.at(-1);
      if (!asset) throw new Error("导入完成但没有找到图片资产");
      updateNodeData(nodeId, {
        assetId: asset.id,
        busy: false,
        detail: asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · 资产库` : "资产库",
        naturalSizeApplied: false,
        previewUrl: asset.previewUrl ?? undefined,
        statusMessage: undefined,
        title: asset.name,
      });
      onAssetImported();
    } catch (error) {
      updateNodeData(nodeId, { busy: false, statusMessage: error instanceof Error ? error.message : "导入图片失败" });
    }
  }, [onAssetImported, projectId, updateNodeData]);

  const nodeActions = useMemo(() => ({ importImage, updateNodeData }), [importImage, updateNodeData]);

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
      setNodes((current) => {
        const group = groupAtPoint(current, position);
        const node: CanvasModuleNode = {
          id: `asset-${asset.id}-${crypto.randomUUID()}`,
          type: "module",
          position: group ? { x: position.x - group.position.x, y: position.y - group.position.y } : position,
          parentId: group?.id,
          extent: group ? "parent" : undefined,
          style: { height: 190, width: 240 },
          data: {
            moduleType: "image",
            assetId: asset.id,
            previewUrl: asset.previewUrl ?? undefined,
            title: asset.name,
            detail: asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · 资产库` : "资产库",
          },
        };
        return group ? parentsFirst(current.concat(node)) : current.concat(node);
      });
    } catch {
      // Ignore malformed external drag data.
    }
  }, [setNodes]);

  const onNodeDragStop: OnNodeDrag<CanvasNode> = useCallback((_event, node) => {
    if (node.type === "group" || node.parentId || !flowRef.current) return;
    const group = flowRef.current.getIntersectingNodes(node).find((candidate) => candidate.type === "group");
    if (!group) return;
    const nodePosition = node.position;
    const groupPosition = group.position;
    setNodes((current) => parentsFirst(current.map((item) => item.id === node.id ? {
      ...item,
      parentId: group.id,
      extent: "parent" as const,
      position: { x: Math.max(8, nodePosition.x - groupPosition.x), y: Math.max(28, nodePosition.y - groupPosition.y) },
    } : item)));
  }, [setNodes]);

  const handleNodeChanges = useCallback((changes: NodeChange<CanvasNode>[]) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  return (
    <div className={styles.surface} ref={surfaceRef}>
      <CanvasNodeActionsProvider value={nodeActions}>
        <ReactFlow<CanvasNode, Edge>
          className={styles.flow}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodeChanges}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
          onInit={(instance) => { flowRef.current = instance; }}
          isValidConnection={isValidConnection}
          deleteKeyCode={interactionMode === "select" ? ["Backspace", "Delete"] : null}
          defaultViewport={viewport}
          elementsSelectable={interactionMode === "select"}
          fitView={!initialDocument}
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          maxZoom={2}
          minZoom={0.2}
          nodesConnectable={interactionMode === "select"}
          nodesDraggable={interactionMode === "select"}
          panOnDrag={interactionMode === "pan" ? [0, 1, 2] : [1, 2]}
          selectionOnDrag={interactionMode === "select"}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#d9dce6" />
          <Controls className={styles.controls} showInteractive={false} />
        </ReactFlow>
      </CanvasNodeActionsProvider>
    </div>
  );
});
