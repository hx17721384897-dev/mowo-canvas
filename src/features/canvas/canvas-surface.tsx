"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  MiniMap,
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
import { Icon } from "@/app/components/app-icon";
import type { CanvasDocumentState } from "@/features/projects/types";
import type { FrameExtractionTask, SavedFrameSequence } from "@/features/frame-extraction/types";
import { FrameSequenceViewer } from "@/features/frame-extraction/frame-sequence-viewer";
import { getCanvasModule } from "./module-registry";
import { CanvasNodeActionsProvider } from "./node-actions-context";
import { GroupNode, ModuleNode } from "./nodes/module-node";
import type { CanvasModuleData, CanvasModuleNode, CanvasNode } from "./types";
import styles from "./canvas.module.css";

export type CanvasInteractionMode = "pan" | "select";
export type CanvasInsertType = "audio" | "frame-extraction" | "group" | "image" | "text" | "video";
export type CanvasSurfaceHandle = {
  addNode: (type: CanvasInsertType) => void;
  focusAsset: (assetId: string) => void;
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

const shortcuts = [
  { keys: "Ctrl（按住）", action: "临时切换选择 / 移动", status: "规划中" },
  { keys: "滚轮", action: "缩放画布", status: "可用" },
  { keys: "拖动", action: "框选多个节点（选择模式）", status: "可用" },
  { keys: "Ctrl + C / Ctrl + V", action: "复制、粘贴节点或剪贴板文本 / 图片", status: "规划中" },
  { keys: "Ctrl + G", action: "将选中节点打组", status: "可用" },
  { keys: "Ctrl + Shift + G", action: "解散选中的组", status: "可用" },
  { keys: "Delete / Backspace", action: "删除选中节点（选择模式）", status: "可用" },
] as const;

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
    "frame-extraction": { height: 150, width: 250 },
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
  const [liveZoom, setLiveZoom] = useState(viewport.zoom);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ nodeId: string; sourceId: string } | null>(null);
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
        const selected = current.filter((node) => node.selected && !node.parentId && node.type !== "group");
        if (selected.length >= 2) {
          const left = Math.min(...selected.map((node) => node.position.x));
          const top = Math.min(...selected.map((node) => node.position.y));
          const right = Math.max(...selected.map((node) => node.position.x + (node.measured?.width ?? Number(node.style?.width ?? 240))));
          const bottom = Math.max(...selected.map((node) => node.position.y + (node.measured?.height ?? Number(node.style?.height ?? 180))));
          const groupId = `group-${crypto.randomUUID()}`;
          const group: CanvasNode = { id: groupId, type: "group", position: { x: left - 28, y: top - 46 }, selected: true, style: { height: bottom - top + 74, width: right - left + 56 }, data: { label: `组 · ${selected.length} 项` } };
          const selectedIds = new Set(selected.map((node) => node.id));
          return parentsFirst([group, ...current.map((node) => selectedIds.has(node.id) ? { ...node, selected: false, parentId: groupId, extent: undefined, position: { x: node.position.x - group.position.x, y: node.position.y - group.position.y } } : { ...node, selected: false })] as CanvasNode[]);
        }
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

  const dissolveSelectedGroups = useCallback(() => {
    setNodes((current) => {
      const groups = current.filter((node) => node.type === "group" && node.selected);
      if (!groups.length) return current;
      const positions = new Map(groups.map((group) => [group.id, group.position]));
      const groupIds = new Set(positions.keys());
      return current.filter((node) => !groupIds.has(node.id)).map((node) => {
        if (!node.parentId || !groupIds.has(node.parentId)) return node;
        const parent = positions.get(node.parentId)!;
        return { ...node, parentId: undefined, extent: undefined, position: { x: parent.x + node.position.x, y: parent.y + node.position.y }, selected: true };
      });
    });
  }, [setNodes]);

  const ungroupNode = useCallback((groupId: string) => {
    setNodes((current) => {
      const group = current.find((node) => node.id === groupId && node.type === "group");
      if (!group) return current;
      return current.filter((node) => node.id !== groupId).map((node) => node.parentId === groupId ? { ...node, parentId: undefined, extent: undefined, position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y }, selected: true } : node);
    });
  }, [setNodes]);

  useEffect(() => {
    const handleGrouping = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']") || !event.ctrlKey || event.key.toLowerCase() !== "g") return;
      event.preventDefault();
      if (event.shiftKey) dissolveSelectedGroups(); else addNode("group");
    };
    window.addEventListener("keydown", handleGrouping);
    return () => window.removeEventListener("keydown", handleGrouping);
  }, [addNode, dissolveSelectedGroups]);

  const focusAsset = useCallback((assetId: string) => {
    const instance = flowRef.current;
    if (!instance) return;
    const matches = instance.getNodes().filter((node) => isModuleNode(node) && node.data.assetId === assetId);
    if (!matches.length) return;
    const matchIds = new Set(matches.map((node) => node.id));
    setNodes((current) => current.map((node) => ({ ...node, selected: matchIds.has(node.id) })));
    void instance.fitView({ nodes: matches, duration: 500, padding: 0.5, maxZoom: 1.2 });
  }, [setNodes]);

  useImperativeHandle(ref, () => ({ addNode, focusAsset, redo, undo }), [addNode, focusAsset, redo, undo]);

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

  const startFrameExtraction = useCallback(async (nodeId: string) => {
    const processor = nodes.find((node) => node.id === nodeId && isModuleNode(node));
    if (!processor || processor.type !== "module") return;
    const assetIds = edges.filter((edge) => edge.target === nodeId && edge.targetHandle === "animated-images")
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .filter(isModuleNode).flatMap((node) => node.data.assetId ? [node.data.assetId] : []);
    if (!assetIds.length) { updateNodeData(nodeId, { statusMessage: "请先连接至少一张 APNG 或 GIF 动图" }); return; }
    updateNodeData(nodeId, { busy: true, statusMessage: `正在拆解 ${assetIds.length} 张动图…` });
    try {
      const response = await fetch("/api/frame-extraction/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, assetIds, taskId: processor.data.frameTask?.id }) });
      const payload = await response.json() as { task?: FrameExtractionTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? "拆帧失败");
      const task = payload.task;
      const resultEdge = edges.find((edge) => edge.source === nodeId && edge.sourceHandle === "frame-sequences");
      const existingResult = resultEdge ? nodes.find((node) => node.id === resultEdge.target) : undefined;
      const existingResultId = isModuleNode(existingResult) && existingResult.data.moduleType === "frame-result" ? existingResult.id : undefined;
      const resultId = existingResultId ?? `frame-result-${crypto.randomUUID()}`;
      setNodes((current) => {
        const updated = current.map((node) => {
          if (node.id === nodeId && isModuleNode(node)) return { ...node, data: { ...node.data, busy: false, statusMessage: task.status === "partial" ? "部分素材拆解失败" : "拆帧完成", frameTask: task } };
          if (node.id === existingResultId && isModuleNode(node)) return { ...node, data: { ...node.data, frameTask: task } };
          return node;
        });
        const resultNode: CanvasModuleNode = { id: resultId, type: "module", position: { x: processor.position.x + 360, y: processor.position.y - 110 }, data: { moduleType: "frame-result", frameTask: task } };
        return existingResultId ? updated : updated.concat(resultNode);
      });
      if (!existingResultId) setEdges((currentEdges) => addEdge({ id: `frame-result-edge-${crypto.randomUUID()}`, source: nodeId, sourceHandle: "frame-sequences", target: resultId, targetHandle: "source-task", type: "smoothstep" }, currentEdges));
    } catch (error) {
      updateNodeData(nodeId, { busy: false, statusMessage: error instanceof Error ? error.message : "拆帧失败" });
    }
  }, [edges, nodes, projectId, setEdges, setNodes, updateNodeData]);

  const updateFrameDraft = useCallback((nodeId: string, task: FrameExtractionTask) => updateNodeData(nodeId, { frameTask: task }), [updateNodeData]);
  const openFrameViewer = useCallback((nodeId: string, sourceId: string) => setViewer({ nodeId, sourceId }), []);

  const materializeFrameSequence = useCallback(async (nodeId: string, sourceId: string) => {
    const result = nodes.find((node) => node.id === nodeId);
    if (!isModuleNode(result) || !result.data.frameTask) return;
    let sequence = result.data.savedSequences?.[sourceId];
    if (!sequence) {
      const response = await fetch(`/api/frame-extraction/tasks/${result.data.frameTask.id}/sources/${sourceId}/save`, { method: "POST" });
      const payload = await response.json() as { sequence?: SavedFrameSequence; error?: string };
      if (!response.ok || !payload.sequence) { updateNodeData(nodeId, { statusMessage: payload.error ?? "保存序列失败" }); return; }
      sequence = payload.sequence;
      updateNodeData(nodeId, { savedSequences: { ...result.data.savedSequences, [sourceId]: sequence }, statusMessage: "序列已保存" });
    }
    const instance = flowRef.current;
    if (!instance) return;
    const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(sequence.assets.length))));
    const groupId = `sequence-group-${crypto.randomUUID()}`;
    const base = { x: result.position.x + 30, y: result.position.y + 560 };
    const width = columns * 150 + 30;
    const rows = Math.ceil(sequence.assets.length / columns);
    const group: CanvasNode = { id: groupId, type: "group", position: base, style: { width, height: rows * 150 + 60 }, data: { label: `${sequence.name} · ${sequence.assets.length} 帧` } };
    const children: CanvasModuleNode[] = sequence.assets.map((asset, index) => ({ id: `frame-asset-${asset.id}-${crypto.randomUUID()}`, type: "module", parentId: groupId, extent: "parent", position: { x: 18 + (index % columns) * 150, y: 38 + Math.floor(index / columns) * 150 }, style: { width: 132, height: 132 }, data: { moduleType: "image", assetId: asset.id, previewUrl: asset.previewUrl, title: `${String(index + 1).padStart(3, "0")} · ${asset.name}`, naturalSizeApplied: true } }));
    setNodes((current) => parentsFirst(current.concat(group, ...children)));
    onAssetImported();
    window.setTimeout(() => void instance.fitView({ nodes: [group], duration: 450, padding: .35, maxZoom: 1 }), 50);
  }, [nodes, onAssetImported, setNodes, updateNodeData]);

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

  const nodeActions = useMemo(() => ({ groupSelection: () => addNode("group"), importImage, materializeFrameSequence, openFrameViewer, startFrameExtraction, ungroupNode, updateFrameDraft, updateNodeData }), [addNode, importImage, materializeFrameSequence, openFrameViewer, startFrameExtraction, ungroupNode, updateFrameDraft, updateNodeData]);

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
          extent: undefined,
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
    if (node.type === "group" || !flowRef.current) return;
    const width = node.measured?.width ?? Number(node.style?.width ?? 0);
    const height = node.measured?.height ?? Number(node.style?.height ?? 0);
    if (node.parentId) {
      const parent = flowRef.current.getNode(node.parentId);
      if (!parent) return;
      const parentWidth = parent.measured?.width ?? Number(parent.style?.width ?? 0);
      const parentHeight = parent.measured?.height ?? Number(parent.style?.height ?? 0);
      const center = { x: node.position.x + width / 2, y: node.position.y + height / 2 };
      if (center.x < -24 || center.y < -24 || center.x > parentWidth + 24 || center.y > parentHeight + 24) {
        setNodes((current) => parentsFirst(current.map((item) => item.id === node.id ? { ...item, parentId: undefined, extent: undefined, position: { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } } : item)));
      }
      return;
    }
    const center = { x: node.position.x + width / 2, y: node.position.y + height / 2 };
    const group = flowRef.current.getNodes().find((candidate) => {
      if (candidate.type !== "group") return false;
      const groupWidth = candidate.measured?.width ?? Number(candidate.style?.width ?? 0);
      const groupHeight = candidate.measured?.height ?? Number(candidate.style?.height ?? 0);
      return center.x >= candidate.position.x + 12 && center.x <= candidate.position.x + groupWidth - 12 && center.y >= candidate.position.y + 12 && center.y <= candidate.position.y + groupHeight - 12;
    });
    if (!group) return;
    const relativePosition = { x: node.position.x - group.position.x, y: node.position.y - group.position.y };
    setNodes((current) => parentsFirst(current.map((item) => {
      if (item.id === node.id) return { ...item, parentId: group.id, extent: undefined, position: relativePosition };
      if (item.id === group.id) {
        const currentWidth = item.measured?.width ?? Number(item.style?.width ?? 0);
        const currentHeight = item.measured?.height ?? Number(item.style?.height ?? 0);
        return { ...item, style: { ...item.style, width: Math.max(currentWidth, relativePosition.x + width + 20), height: Math.max(currentHeight, relativePosition.y + height + 20) } };
      }
      return item;
    })));
  }, [setNodes]);

  const handleNodeChanges = useCallback((changes: NodeChange<CanvasNode>[]) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  const centerOrigin = useCallback(() => {
    const instance = flowRef.current;
    if (!instance) return;
    void instance.setCenter(0, 0, { duration: 450, zoom: instance.getZoom() });
  }, []);

  const changeZoom = useCallback((nextZoom: number) => {
    setLiveZoom(nextZoom);
    void flowRef.current?.zoomTo(nextZoom, { duration: 100 });
  }, []);

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
          onMove={(_event, nextViewport) => setLiveZoom(nextViewport.zoom)}
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
          {miniMapOpen ? (
            <MiniMap
              className={styles.miniMap}
              maskColor="rgba(239, 240, 244, .72)"
              nodeColor={(node) => node.type === "group" ? "#d7c8aa" : "#776fe4"}
              nodeStrokeColor="#ffffff"
              nodeStrokeWidth={2}
              pannable
              zoomable
            />
          ) : null}
          <div className={`${styles.locationTools} nodrag nopan`}>
            <button aria-label={miniMapOpen ? "隐藏小地图" : "显示小地图"} className={miniMapOpen ? styles.locationButtonActive : ""} onClick={() => setMiniMapOpen((open) => !open)} title={miniMapOpen ? "隐藏小地图" : "显示小地图"} type="button"><Icon name="compass" /></button>
            <button aria-label="定位到画布原始中心" onClick={centerOrigin} title="定位到画布原始中心" type="button"><Icon name="focus" /></button>
            <label className={styles.zoomControl}>
              <span className={styles.srOnly}>调整画布缩放</span>
              <input aria-label="调整画布缩放" max="2" min="0.2" onChange={(event) => changeZoom(Number(event.target.value))} step="0.01" type="range" value={liveZoom} />
              <output>{Math.round(liveZoom * 100)}%</output>
            </label>
            <button aria-label="查看画布快捷键" onClick={() => setShortcutsOpen(true)} title="查看画布快捷键" type="button"><Icon name="help" /></button>
          </div>
        </ReactFlow>
      </CanvasNodeActionsProvider>
      {shortcutsOpen ? (
        <div className={styles.shortcutBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShortcutsOpen(false)}>
          <section aria-labelledby="canvas-shortcuts-title" aria-modal="true" className={styles.shortcutDialog} role="dialog">
            <header>
              <div><strong id="canvas-shortcuts-title">画布快捷键</strong><span>当前能力与后续计划一览</span></div>
              <button aria-label="关闭快捷键弹窗" onClick={() => setShortcutsOpen(false)} type="button">×</button>
            </header>
            <div className={styles.shortcutList}>
              {shortcuts.map((shortcut) => (
                <div className={styles.shortcutRow} key={shortcut.keys}>
                  <kbd>{shortcut.keys}</kbd>
                  <span>{shortcut.action}</span>
                  <small className={shortcut.status === "可用" ? styles.shortcutReady : styles.shortcutPlanned}>{shortcut.status}</small>
                </div>
              ))}
            </div>
            <footer><button onClick={() => setShortcutsOpen(false)} type="button">知道了</button></footer>
          </section>
        </div>
      ) : null}
      {viewer ? (() => {
        const node = nodes.find((candidate) => candidate.id === viewer.nodeId);
        return isModuleNode(node) && node.data.frameTask ? <FrameSequenceViewer initialSourceId={viewer.sourceId} onClose={() => setViewer(null)} onPlace={(sourceId) => { void materializeFrameSequence(viewer.nodeId, sourceId); setViewer(null); }} task={node.data.frameTask} /> : null;
      })() : null}
    </div>
  );
});
