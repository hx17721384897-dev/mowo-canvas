"use client";
import { useProgressNavigation } from "@/components/navigation-progress";
import { useVideoImport } from "./video-import";
import { isLocalVideo } from "@/features/assets/video-policy";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  getBezierPath,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeChange,
  type OnNodeDrag,
  type OnConnectEnd,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { ASSET_DRAG_TYPE, SEQUENCE_DRAG_TYPE, type AssetSequence, type AssetSummary } from "@/features/assets/types";
import { needsVideoEditor } from "@/features/assets/video-policy";
import { Icon } from "@/app/components/app-icon";
import type { CanvasDocumentState } from "@/features/projects/types";
import type { FrameExtractionTask, SavedFrameSequence } from "@/features/frame-extraction/types";
import { FrameSequenceViewer } from "@/features/frame-extraction/frame-sequence-viewer";
import { getCanvasModule } from "./module-registry";
import { applyGroupDrop, collapsedGroupSize, combineGroups, containGroupMembers, dissolveGroups, groupDropTarget, groupPresentation, parentsFirst, setAllGroupResizeModes, setGroupResizeMode, worldPosition } from "./group-layout";
import { fitFrameBatch, frameBatchCompactSize, restoreFrameBatches, syncFrameBatch } from "./frame-batch-layout";
import { connectedFrameInputs } from "./frame-inputs";
import { groupExportManifest } from "./group-export";
import { canvasClipboardType, copyCanvasSelection, pasteCanvasSelection } from "./canvas-clipboard";
import { initialFrameOrder, isOrderedGroup, layoutOrderedGroup, orderedInsertion, orderedMembersError } from "./ordered-group";
import { imageImportOrder } from "./image-import-order";
import { arrangeGroupChildren, projectExpandedBatches } from "./arrange-group";
import type { FrameInputReview } from "@/features/frame-extraction/types";
import { canConnectPorts, canvasModules, groupMaterialsPort, stitchResultPort } from "./module-metadata";
import type { StitchOutput } from "@/features/frame-extraction/stitch-layout";
import { CanvasNodeActionsProvider } from "./node-actions-context";
import { GroupNode, ModuleNode } from "./nodes/module-node";
import { CropSetup } from "./image-crop-ui";
import { loadCropImage, validCropPlan, type CropPlan } from "./image-crop";
import type { CanvasModuleData, CanvasModuleNode, CanvasNode } from "./types";
import styles from "./canvas.module.css";

export type CanvasInteractionMode = "pan" | "select";
export type CanvasInsertType = "audio" | "batch-crop" | "crop-result" | "frame-extraction" | "video-frame-extraction" | "frame-result" | "frame-stitch" | "group" | "image" | "text" | "video";
export type CanvasSurfaceHandle = {
  placeAsset: (asset: AssetSummary) => void;
  addNode: (type: CanvasInsertType) => void;
  focusAsset: (assetId: string) => void;
  focusSequence: (sequence: AssetSequence) => void;
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

type HistorySnapshot = { edges: Edge[]; nodes: CanvasNode[]; groupContentScaleEnabled: boolean };
type ConnectionMenu = {
  nodeId: string;
  handleId: string;
  fromInput: boolean;
  position: { x: number; y: number };
  anchor: { x: number; y: number };
  path: string;
  options: Array<{ type: Exclude<CanvasInsertType, "group">; handleId: string }>;
};

const nodeTypes = { group: GroupNode, module: ModuleNode };

const shortcuts = [
  { keys: "Ctrl（按住）", action: "临时切换选择 / 移动，松开恢复", status: "可用" },
  { keys: "滚轮", action: "缩放画布", status: "可用" },
  { keys: "拖动", action: "框选相交节点（选择模式）", status: "可用" },
  { keys: "Ctrl + 点击", action: "追加或取消选中节点", status: "可用" },
  { keys: "Ctrl + C / Ctrl + X / Ctrl + V", action: "复制、剪切、粘贴画布节点", status: "可用" },
  { keys: "Ctrl + Z", action: "撤销上一步画布操作", status: "可用" },
  { keys: "Ctrl + G", action: "将选中节点打组", status: "可用" },
  { keys: "Ctrl + Shift + G", action: "解散选中的组", status: "可用" },
  { keys: "Delete / Backspace", action: "删除选中节点（选择模式）", status: "可用" },
] as const;


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

function createSnapshot(nodes: CanvasNode[], edges: Edge[], groupContentScaleEnabled: boolean): HistorySnapshot {
  return structuredClone({ nodes: persistentNodes(nodes), edges: persistentEdges(edges), groupContentScaleEnabled });
}

function layoutOrderedForMode(nodes: CanvasNode[], groupId: string, compact = false) {
  const group = nodes.find((node) => node.id === groupId);
  return group?.type === "group" && group.data.resizeMode === "scale"
    ? containGroupMembers(nodes, groupId, { width: Number(group.style?.width ?? group.width ?? 440),
      height: Number(group.style?.height ?? group.height ?? 300) })
    : layoutOrderedGroup(nodes, groupId, undefined, compact);
}

function snapshotSignature(snapshot: HistorySnapshot) {
  return JSON.stringify(snapshot);
}

function isModuleNode(node: CanvasNode | undefined): node is CanvasModuleNode {
  return node?.type === "module";
}

function findPort(node: CanvasNode | undefined, handleId: string | null | undefined, side: "inputs" | "outputs") {
  if (node?.type === "group" && node.data.stitchResult && side === "inputs" && handleId === stitchResultPort.id) return stitchResultPort;
  if (node?.type === "group" && node.data.frameTask) return canvasModules["frame-batch"][side].find((port) => port.id === handleId);
  if (node?.type === "group" && node.data.frameSourceId) return side === "outputs" ? canvasModules["frame-result"].outputs.find((port) => port.id === handleId) : undefined;
  if (node?.type === "group" && side === "outputs" && handleId === groupMaterialsPort.id) return groupMaterialsPort;
  if (!isModuleNode(node) || !handleId) return undefined;
  return getCanvasModule(node.data.moduleType)[side].find((port) => port.id === handleId);
}

function groupAtPoint(nodes: CanvasNode[], point: { x: number; y: number }, inset = 0) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of parentsFirst(nodes).reverse()) {
    if (node.type !== "group" || node.data.collapsed || node.hidden || node.data.frameTask || node.data.frameSourceId) continue;
    const position = { ...node.position };
    let parent = node.parentId ? byId.get(node.parentId) : undefined;
    let hidden = false;
    while (parent) {
      if (parent.type === "group" && parent.data.collapsed) { hidden = true; break; }
      position.x += parent.position.x;
      position.y += parent.position.y;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    if (hidden) continue;
    const width = node.width ?? node.measured?.width ?? Number(node.style?.width ?? 0);
    const height = node.height ?? node.measured?.height ?? Number(node.style?.height ?? 0);
    if (point.x >= position.x + inset && point.x <= position.x + width - inset
      && point.y >= position.y + inset && point.y <= position.y + height - inset) return { ...node, position };
  }
}

function materialNode(type: Exclude<CanvasInsertType, "group">, position: { x: number; y: number }): CanvasModuleNode {
  const sizes: Record<typeof type, { height: number; width: number }> = {
    audio: { height: 120, width: 280 },
    image: { height: 220, width: 260 },
    text: { height: 200, width: 300 },
    video: { height: 180, width: 280 },
    "frame-extraction": { height: 150, width: 250 },
    "video-frame-extraction": { height: 0, width: canvasModules["video-frame-extraction"].width },
    "frame-result": { height: 0, width: canvasModules["frame-result"].width },
    "frame-stitch": { height: 0, width: canvasModules["frame-stitch"].width },
    "batch-crop": { height: 0, width: 245 },
    "crop-result": { height: 0, width: 660 },
  };
  return {
    id: `material-${type}-${crypto.randomUUID()}`,
    type: "module",
    position,
    selected: true,
    style: sizes[type].height === 0 || type === "frame-extraction" ? { width: sizes[type].width } : sizes[type],
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
  const navigate = useProgressNavigation();
  const initialGroupContentScaleEnabled = initialDocument?.groupContentScaleEnabled
    ?? Boolean(initialDocument?.nodes.some((node) => node.type === "group" && node.data.resizeMode === "scale"));
  const startingNodes = useMemo(() => {
    const restored = restoreFrameBatches(initialDocument?.nodes ?? []);
    return initialGroupContentScaleEnabled ? setAllGroupResizeModes(restored, "scale") : restored;
  }, [initialDocument, initialGroupContentScaleEnabled]);
  const startingEdges = (initialDocument?.edges ?? []).map((edge) => ({ ...edge, type: "default" }));
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(parentsFirst(startingNodes));
  const [groupContentScaleEnabled, setGroupContentScaleEnabled] = useState(initialGroupContentScaleEnabled);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [groupTransition, setGroupTransition] = useState<{ id: string; kind: "merge" | "nest" | "expand" } | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<ConnectionMenu | null>(null);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(startingEdges);
  const { hiddenBy, covers, visibleEdges } = useMemo(() => groupPresentation(nodes, edges), [nodes, edges]);
  const highlightedEdges = useMemo(() => new Set(visibleEdges.some((edge) => edge.selected) ? [] : visibleEdges.filter((edge) =>
    !edge.hidden && hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode))), [visibleEdges, hoveredNode]);
  const relatedNodes = useMemo(() => new Set([...highlightedEdges].flatMap((edge) => [edge.source, edge.target])), [highlightedEdges]);
  const interactiveEdges = useMemo(() => visibleEdges.map((edge) => highlightedEdges.has(edge)
    ? { ...edge, className: [edge.className, styles.relatedEdge].filter(Boolean).join(" ") }
    : edge), [visibleEdges, highlightedEdges]);
  const [dropGroup, setDropGroup] = useState<string>();
  const batchLayout = useMemo(() => projectExpandedBatches(nodes), [nodes]);
  const interactiveNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    ...(batchLayout.positions.has(node.id) ? { position: batchLayout.positions.get(node.id)!, draggable: false } : {}),
    ...(batchLayout.sizes.has(node.id) ? { ...batchLayout.sizes.get(node.id), style: { ...node.style, ...batchLayout.sizes.get(node.id) } } : {}),
    extent: node.extent === "parent" ? undefined : node.extent,
    hidden: node.hidden || hiddenBy.has(node.id),
    ...(node.type === "group" && node.data.collapsed ? {
      ...collapsedGroupSize, style: { ...node.style, ...collapsedGroupSize },
    } : {}),
    className: [node.className, "nopan", relatedNodes.has(node.id) && styles.relatedNode,
      dropGroup === node.id && styles.groupDropTarget,
      node.type === "group" && node.data.frameSourceId && styles.batchLayoutMember,
      node.parentId && nodes.some((parent) => parent.id === node.parentId && parent.type === "group" && !parent.data.frameTask && !parent.data.frameSourceId) && styles.groupContainedMember,
      node.parentId && nodes.some((parent) => parent.id === node.parentId && parent.type === "group" && parent.data.resizeMode === "scale") && styles.groupScaledMember,
      groupTransition?.id === node.id && groupTransition.kind === "merge" && styles.groupMerged,
      groupTransition?.id === node.id && groupTransition.kind === "nest" && styles.groupNested,
      groupTransition?.kind === "expand" && groupTransition.id === node.parentId && styles.groupMemberRevealed,
    ].filter(Boolean).join(" "),
  })), [nodes, hiddenBy, relatedNodes, groupTransition, dropGroup, batchLayout]);
  useEffect(() => {
    if (!groupTransition) return;
    const timer = setTimeout(() => setGroupTransition(null), 280);
    return () => clearTimeout(timer);
  }, [groupTransition]);
  const [viewport, setViewport] = useState<Viewport>(initialDocument?.viewport ?? { x: 0, y: 0, zoom: 1 });
  const [liveZoom, setLiveZoom] = useState(viewport.zoom);
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ nodeId: string; sourceId: string } | null>(null);
  const [orderedPreviewGroupId, setOrderedPreviewGroupId] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<Pick<CropPlan, "sourceAssetId" | "sourceUrl" | "sourceName" | "width" | "height"> & { nodeId: string } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const boxSelecting = useRef(false);
  const boxHits = useRef<Set<string> | null>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const insertionIndexRef = useRef(0);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapshotRef = useRef<HistorySnapshot | null>(null);
  const historyRef = useRef({ current: createSnapshot(startingNodes, startingEdges, initialGroupContentScaleEnabled), future: [] as HistorySnapshot[], past: [] as HistorySnapshot[] });
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
    if (nodes.some((node) => node.dragging || node.resizing)) return;
    const snapshot = createSnapshot(nodes, edges, groupContentScaleEnabled);
    if (snapshotSignature(snapshot) === snapshotSignature(historyRef.current.current)) return;
    pendingSnapshotRef.current = snapshot;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(commitPendingHistory, 280);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [commitPendingHistory, edges, groupContentScaleEnabled, nodes]);

  useEffect(() => {
    const mode = groupContentScaleEnabled ? "scale" : "reflow";
    const needsSync = nodes.filter((node) => node.type === "group" && !node.data.frameTask && !node.data.frameSourceId
      && ((node.data.resizeMode ?? "reflow") !== mode || (mode === "scale" && nodes.some((child) =>
        child.parentId === node.id && child.type === "module" && child.data.moduleType === "image"
        && !node.data.scaleBase?.[child.id]))));
    if (!needsSync.length) return;
    setNodes((current) => needsSync.reduce((next, group) => setGroupResizeMode(next, group.id, mode), current));
  }, [groupContentScaleEnabled, nodes, setNodes]);

  useEffect(() => {
    onAssetIdsChange(assetIdSignature ? assetIdSignature.split("\n") : []);
  }, [assetIdSignature, onAssetIdsChange]);

  useEffect(() => {
    onDocumentChange({ schemaVersion: 1, groupContentScaleEnabled, nodes: persistentNodes(nodes), edges: persistentEdges(edges), viewport });
  }, [edges, groupContentScaleEnabled, nodes, onDocumentChange, viewport]);

  const applySnapshot = useCallback((snapshot: HistorySnapshot) => {
    pendingSnapshotRef.current = null;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    setNodes(structuredClone(snapshot.nodes));
    setEdges(structuredClone(snapshot.edges));
    setGroupContentScaleEnabled(snapshot.groupContentScaleEnabled);
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

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const openCropSetup = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!isModuleNode(node) || node.data.moduleType !== "image" || !node.data.assetId || !node.data.previewUrl) return;
    void loadCropImage(node.data.previewUrl).then((image) => setCropSource({ nodeId, sourceAssetId: node.data.assetId!,
      sourceUrl: node.data.previewUrl!, sourceName: node.data.title ?? "图片", width: image.naturalWidth, height: image.naturalHeight }))
      .catch(() => setConnectionNotice("无法读取原图，不能开始裁切"));
  }, []);
  const createCropPreview = useCallback((plan: CropPlan) => {
    if (!cropSource) return;
    const source = nodesRef.current.find((node) => node.id === cropSource.nodeId);
    if (!source) { setCropSource(null); return; }
    const position = worldPosition(source, new Map(nodesRef.current.map((node) => [node.id, node])));
    const nodeId = `crop-result-${crypto.randomUUID()}`;
    commitPendingHistory();
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
      id: nodeId, type: "module", position: { x: position.x + Number(source.style?.width ?? source.width ?? 260) + 110, y: position.y },
      selected: true, data: { moduleType: "crop-result", cropPlan: plan }, style: { width: 660 },
    }]);
    setEdges((current) => addEdge({ id: `crop-edge-${crypto.randomUUID()}`, source: source.id, sourceHandle: "image",
      target: nodeId, targetHandle: "source-image", type: "default" }, current));
    setCropSource(null);
  }, [commitPendingHistory, cropSource, setEdges, setNodes]);
  const openOrderedCrop = useCallback(async (groupId: string) => {
    const current = nodesRef.current;
    const group = current.find((node) => node.id === groupId);
    if (group?.type !== "group" || !group.data.orderedChildIds?.length) return;
    const members = group.data.orderedChildIds.map((id) => current.find((node) => node.id === id));
    if (members.some((node) => !isModuleNode(node) || node.data.moduleType !== "image" || !node.data.assetId || !node.data.previewUrl)) {
      setConnectionNotice("有序组中存在无法裁切的图片"); return;
    }
    try {
      const sources = await Promise.all(members.map(async (node) => {
        const member = node as Extract<CanvasNode, { type: "module" }>;
        const image = await loadCropImage(member.data.previewUrl!);
        return { assetId: member.data.assetId!, url: member.data.previewUrl!, width: image.naturalWidth, height: image.naturalHeight };
      }));
      const first = sources[0];
      const plan: CropPlan = { sourceAssetId: first.assetId, sourceUrl: first.url, sourceName: group.data.label,
        width: first.width, height: first.height, grids: [], sources, ordered: true,
        output: { width: first.width, height: first.height, mode: "pad" },
        items: sources.map((source, index) => ({ id: `ordered-${index}`, rect: { x: 0, y: 0, width: source.width, height: source.height },
          zoom: 1, dx: 0, dy: 0, durationMs: group.data.frameDurationsMs?.[members[index]!.id] ?? 125 })) };
      if (!validCropPlan(plan)) { setConnectionNotice("有序组图片尺寸或数量超过裁切上限"); return; }
      const position = worldPosition(group, new Map(current.map((node) => [node.id, node])));
      const nodeId = `crop-result-${crypto.randomUUID()}`;
      commitPendingHistory();
      setNodes((nodes) => [...nodes.map((node) => ({ ...node, selected: false })), {
        id: nodeId, type: "module", position: { x: position.x + Number(group.style?.width ?? group.width ?? 400) + 110, y: position.y },
        selected: true, data: { moduleType: "crop-result", cropPlan: plan }, style: { width: 660 },
      }]);
      setEdges((edges) => addEdge({ id: `crop-edge-${crypto.randomUUID()}`, source: groupId, sourceHandle: "group-materials",
        target: nodeId, targetHandle: "source-group", type: "default" }, edges));
      setOrderedPreviewGroupId(null);
    } catch { setConnectionNotice("有序组图片读取失败，无法创建裁切预览"); }
  }, [commitPendingHistory, setEdges, setNodes]);
  const staticReviews = useRef(new Map<string, FrameInputReview>());
  const [reviewRevision, setReviewRevision] = useState(0);
  const [orderHint, setOrderHint] = useState<{ groupId: string; position: { x: number; y: number } } | null>(null);
  const reviewStaticMembers = useCallback(async (members: CanvasNode[]) => {
    if (!members.length || members.some((node) => !isModuleNode(node) || node.data.moduleType !== "image"
      || !node.data.assetId || !node.data.previewUrl || node.data.busy)) {
      throw new Error("有序组只接受已导入的静态图片，请先移出动图、其他节点、空图片或子组。");
    }
    const ids = [...new Set(members.flatMap((node) => isModuleNode(node) && node.data.assetId ? [node.data.assetId] : []))]
      .filter((id) => !staticReviews.current.has(id) || staticReviews.current.get(id)?.status === "unavailable");
    for (let offset = 0; offset < ids.length; offset += 500) {
      const response = await fetch("/api/frame-extraction/review", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, assetIds: ids.slice(offset, offset + 500) }) });
      const payload = await response.json() as { items?: FrameInputReview[]; error?: string };
      if (!response.ok || !payload.items) throw new Error(payload.error ?? "静态图片检查失败，请重试");
      for (const item of payload.items) staticReviews.current.set(item.assetId, item);
    }
    setReviewRevision((value) => value + 1);
    const error = orderedMembersError(members, staticReviews.current);
    if (error) throw new Error(error);
  }, [projectId]);

  const orderedSignature = JSON.stringify(nodes.filter(isOrderedGroup).map((group) => [group.id,
    nodes.filter((node) => node.parentId === group.id).map((node) => [node.id, node.type === "module" ? node.data.assetId : "group"])]));
  const checkedGroups = useRef(new Map<string, string>());
  useEffect(() => {
    for (const group of nodesRef.current.filter(isOrderedGroup)) {
      const members = nodesRef.current.filter((node) => node.parentId === group.id);
      const signature = JSON.stringify(members.map((node) => [node.id, node.type === "module" ? node.data.assetId : "group"]));
      if (checkedGroups.current.get(group.id) === signature) continue;
      checkedGroups.current.set(group.id, signature);
      void reviewStaticMembers(members).catch((error: unknown) => setConnectionNotice(error instanceof Error ? error.message : "无法检查有序组"));
    }
  }, [orderedSignature, reviewStaticMembers]);

  useEffect(() => {
    if (nodes.some((node) => node.dragging || node.resizing)) return;
    setNodes((current) => {
      let next = current;
      for (const group of current.filter(isOrderedGroup)) {
        const members = current.filter((node) => node.parentId === group.id);
        if (!orderedMembersError(members, staticReviews.current)) next = layoutOrderedGroup(next, group.id);
      }
      return next;
    });
  }, [nodes, reviewRevision, setNodes]);

  const addNode = useCallback((type: CanvasInsertType, ordered = false) => {
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
        if (ordered && (selected.length !== current.filter((node) => node.selected).length
          || orderedMembersError(selected, staticReviews.current))) return current;
        if (selected.length >= 2) {
          const left = Math.min(...selected.map((node) => node.position.x));
          const top = Math.min(...selected.map((node) => node.position.y));
          const right = Math.max(...selected.map((node) => node.position.x + (node.measured?.width ?? Number(node.style?.width ?? 240))));
          const bottom = Math.max(...selected.map((node) => node.position.y + (node.measured?.height ?? Number(node.style?.height ?? 180))));
          const groupId = `group-${crypto.randomUUID()}`;
          const orderedIds = initialFrameOrder(selected);
          const group: CanvasNode = { id: groupId, type: "group", position: { x: left - 28, y: top - 46 }, selected: true, style: { height: bottom - top + 74, width: right - left + 56 }, data: { label: `${ordered ? "有序组" : "组"} · ${selected.length} 项`, ...(ordered ? { orderedChildIds: orderedIds } : {}) } };
          const selectedIds = new Set(selected.map((node) => node.id));
          return parentsFirst([group, ...current.map((node) => selectedIds.has(node.id) ? { ...node, selected: false, parentId: groupId, extent: undefined, position: { x: node.position.x - group.position.x, y: node.position.y - group.position.y } } : { ...node, selected: false })] as CanvasNode[]);
        }
        if (ordered) return current;
        return parentsFirst(deselected.concat({
          id: `group-${crypto.randomUUID()}`,
          type: "group",
          position: { x: center.x - 220 + offset, y: center.y - 150 + offset },
          selected: true,
          style: { height: 300, width: 440 },
          data: { label: "组" },
        }));
      }
      const node = materialNode(type, { x: center.x - (type === "frame-result" ? canvasModules[type].width / 2 : 130) + offset, y: center.y - 100 + offset });
      return [...deselected, node];
    });
  }, [commitPendingHistory, setNodes]);

  const createOrderedGroup = useCallback(async () => {
    const selected = nodesRef.current.filter((node) => node.selected);
    const signature = JSON.stringify(selected.map((node) => [node.id, node.type === "module" && node.data.assetId]));
    try {
      await reviewStaticMembers(selected);
      const current = nodesRef.current.filter((node) => node.selected);
      if (signature !== JSON.stringify(current.map((node) => [node.id, node.type === "module" && node.data.assetId]))) {
        throw new Error("选中内容已变化，请重新创建有序组。");
      }
      addNode("group", true);
    } catch (error) { setConnectionNotice(error instanceof Error ? error.message : "无法创建有序组"); }
  }, [addNode, reviewStaticMembers]);

  const dissolveSelectedGroups = useCallback(() => {
    const removed = new Set(flowRef.current?.getNodes().filter((node) => node.type === "group" && node.selected && !node.data.frameTask && !node.data.frameSourceId).map((node) => node.id));
    if (!removed.size) return;
    commitPendingHistory();
    setEdges((current) => current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)));
    setNodes((current) => dissolveGroups(current, removed));
  }, [commitPendingHistory, setEdges, setNodes]);

  const ungroupNode = useCallback((groupId: string) => {
    commitPendingHistory();
    setEdges((current) => current.filter((edge) => edge.source !== groupId && edge.target !== groupId));
    setNodes((current) => dissolveGroups(current, new Set([groupId])));
  }, [commitPendingHistory, setEdges, setNodes]);

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


  const isValidConnection: IsValidConnection<Edge> = useCallback((connection) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (isModuleNode(targetNode) && targetNode.data.moduleType === "frame-stitch"
      && !(sourceNode?.type === "group" && (sourceNode.data.frameTask || sourceNode.data.frameSourceId))) return false;
    if (connection.targetHandle === stitchResultPort.id && connection.sourceHandle !== "stitched-images") return false;
    const sourcePort = findPort(sourceNode, connection.sourceHandle, "outputs");
    const targetPort = findPort(targetNode, connection.targetHandle, "inputs");
    if (connection.source === connection.target || !sourcePort || !targetPort || !canConnectPorts(sourcePort, targetPort)) return false;
    if (targetPort.multiple) return true;
    return !edges.some((edge) => edge.target === connection.target && (edge.targetHandle ?? targetPort.id) === targetPort.id);
  }, [edges, nodes]);

  const onConnect = useCallback((connection: Connection) => {
    setConnectionNotice("");
    setEdges((currentEdges) => addEdge({ ...connection, type: "default" }, currentEdges));
  }, [setEdges]);

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (state.isValid || !state.fromHandle?.id || !state.from || !flowRef.current || !surfaceRef.current) return;
    const pointer = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!pointer) return;
    const { clientX, clientY } = pointer;
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || !surfaceRef.current.contains(hit)) return;
    if (hit.closest(".react-flow__node, .react-flow__handle, .react-flow__edge") || state.toHandle) {
      const input = state.fromHandle.type === "target" ? state.fromHandle : state.toHandle;
      const port = input?.type === "target" ? findPort(nodes.find((node) => node.id === input.nodeId), input.id, "inputs") : undefined;
      const occupied = port && !port.multiple && edges.some((edge) => edge.target === input?.nodeId && (edge.targetHandle ?? port.id) === port.id);
      setConnectionNotice(occupied ? "这个输入已连接。" : "无法连接，请将线拖到另一个节点上方向和素材类型兼容的端口。");
      return;
    }
    if (!hit.closest(".react-flow__pane")) return;
    const fromInput = state.fromHandle.type === "target";
    const nodeId = state.fromHandle.nodeId;
    const handleId = state.fromHandle.id;
    const port = findPort(nodes.find((node) => node.id === nodeId), handleId, fromInput ? "inputs" : "outputs");
    if (!port) return;
    if (fromInput && !port.multiple && edges.some((edge) => edge.target === nodeId && (edge.targetHandle ?? handleId) === handleId)) {
      setConnectionNotice("这个输入已连接。");
      return;
    }
    const options = (Object.keys(canvasModules) as CanvasModuleData["moduleType"][]).flatMap((type) => {
      if (type === "frame-batch" || (type === "frame-result" && fromInput)) return [];
      const anchor = nodes.find((node) => node.id === nodeId);
      if (fromInput && anchor?.type === "module" && anchor.data.moduleType === "frame-stitch") return [];
      if (type === "frame-stitch" && (fromInput || anchor?.type !== "group" || !(anchor.data.frameTask || anchor.data.frameSourceId))) return [];
      const ports = fromInput ? canvasModules[type].outputs : canvasModules[type].inputs;
      return ports.filter((other) => fromInput ? canConnectPorts(other, port) : canConnectPorts(port, other))
        .map((other) => ({ type, handleId: other.id }));
    });
    if (!options.length) {
      setConnectionNotice("当前没有兼容的节点可创建。");
      return;
    }
    const bounds = surfaceRef.current.getBoundingClientRect();
    const position = flowRef.current.screenToFlowPosition({ x: clientX, y: clientY });
    const [path] = getBezierPath({ sourceX: state.from.x, sourceY: state.from.y,
      sourcePosition: state.fromPosition ?? Position.Right, targetX: position.x, targetY: position.y,
      targetPosition: fromInput ? Position.Right : Position.Left });
    setConnectionMenu({ nodeId, handleId, fromInput, position, path, options,
      anchor: { x: Math.max(8, Math.min(clientX - bounds.left, bounds.width - 216)), y: Math.max(8, Math.min(clientY - bounds.top, bounds.height - 240)) } });
  }, [edges, nodes]);

  const createConnectedNode = (option: ConnectionMenu["options"][number]) => {
    if (!connectionMenu || !nodes.some((node) => node.id === connectionMenu.nodeId)) return;
    const { fromInput, nodeId, handleId, position } = connectionMenu;
    const node = materialNode(option.type, position);
    if (fromInput) node.position = { ...position, x: position.x - Number(node.style?.width ?? 250) };
    const edge = fromInput
      ? { source: node.id, sourceHandle: option.handleId, target: nodeId, targetHandle: handleId }
      : { source: nodeId, sourceHandle: handleId, target: node.id, targetHandle: option.handleId };
    commitPendingHistory();
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node]);
    setEdges((current) => addEdge({ ...edge, type: "default" }, current));
    setConnectionMenu(null);
  };

  useEffect(() => {
    if (!connectionMenu && !connectionNotice) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setConnectionMenu(null); setConnectionNotice(""); }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [connectionMenu, connectionNotice]);

  const updateNodeData = useCallback((nodeId: string, data: Partial<CanvasModuleData>) => {
    setNodes((current) => current.map((node) => node.id === nodeId && isModuleNode(node) ? { ...node,
      ...(node.data.moduleType === "video-frame-extraction" && data.busy !== undefined ? { deletable: !data.busy } : {}),
      data: { ...node.data, ...data } } : node));
  }, [setNodes]);

  const frameInputKey = useCallback((nodeId: string) => {
    return JSON.stringify(connectedFrameInputs(nodes, edges, nodeId, "image", "animated-images").map((input) => input.assetId));
  }, [edges, nodes]);

  const videoInputKey = useCallback((nodeId: string) =>
    JSON.stringify(connectedFrameInputs(nodes, edges, nodeId, "video", "video-sources")), [edges, nodes]);

  const openVideoFrameExtraction = useCallback((nodeId: string) => {
    const source = nodesRef.current.find((node) => node.id === nodeId);
    if (!isModuleNode(source) || source.data.moduleType !== "video" || !source.data.assetId) return;
    const connected = flowRef.current?.getEdges().find((edge) => edge.source === nodeId && nodesRef.current.some((node) =>
      node.id === edge.target && isModuleNode(node) && node.data.moduleType === "video-frame-extraction"));
    const id = connected?.target ?? `video-frames-${nodeId}`;
    const origin = flowRef.current?.getInternalNode(nodeId)?.internals.positionAbsolute ?? source.position;
    commitPendingHistory();
    setNodes((current) => {
      const selected = current.map((node) => ({ ...node, selected: node.id === id }));
      if (current.some((node) => node.id === id)) return selected;
      return [...selected, { ...materialNode("video-frame-extraction", { x: origin.x + 360, y: origin.y }), id, selected: true }];
    });
    setEdges((current) => addEdge({ id: `video-frame-input-${nodeId}-${id}`, source: nodeId, sourceHandle: "video", target: id,
      targetHandle: "video-sources", type: "default" }, current));
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id }], duration: 300, padding: .3, maxZoom: 1 }), 80);
  }, [commitPendingHistory, setEdges, setNodes]);

  const attachVideoFrameTask = useCallback((nodeId: string, task: FrameExtractionTask) => {
    if (task.projectId !== projectId || !task.sources.some((source) => source.status !== "failed")) return;
    const processor = nodesRef.current.find((node) => node.id === nodeId);
    if (!isModuleNode(processor)) return;
    const existing = nodesRef.current.find((node) => node.type === "group" && node.data.frameTask?.id === task.id);
    const batchId = existing?.id ?? `frame-batch-${task.id}`;
    const origin = flowRef.current?.getInternalNode(nodeId)?.internals.positionAbsolute ?? processor.position;
    const siblingIds = new Set(flowRef.current?.getEdges().filter((edge) => edge.source === nodeId).map((edge) => edge.target));
    const siblings = nodesRef.current.filter((node) => siblingIds.has(node.id) && node.id !== batchId);
    const y = Math.max(origin.y, ...siblings.map((node) => node.position.y + Number(node.style?.height ?? 225) + 48));
    setNodes((current) => {
      if (!current.some((node) => node.id === nodeId)) return current;
      const batch = current.find((node) => node.id === batchId);
      const updated = current.map((node) => node.id === nodeId && isModuleNode(node) ? { ...node, data: { ...node.data, frameTask: task } } : node);
      return syncFrameBatch(updated, batch?.type === "group" ? batch : { id: batchId, type: "group",
        position: { x: origin.x + canvasModules["video-frame-extraction"].width + 80, y }, data: { label: "动画帧批次" } }, task);
    });
    setEdges((current) => addEdge({ id: `video-frame-result-${nodeId}-${task.id}`, source: nodeId, sourceHandle: "frame-sequences",
      target: batchId, targetHandle: "source-task", type: "default" }, current));
  }, [projectId, setEdges, setNodes]);

  const startFrameExtraction = useCallback(async (nodeId: string, selectedIds: string[]) => {
    const processor = nodes.find((node) => node.id === nodeId && isModuleNode(node));
    if (!processor || processor.type !== "module") return;
    const currentIds = new Set<string>(JSON.parse(frameInputKey(nodeId)));
    const assetIds = selectedIds.filter((id) => currentIds.has(id));
    const restore = selectedIds.length === 0 && processor.data.frameTask;
    if (!assetIds.length && !restore) { updateNodeData(nodeId, { statusMessage: "请先连接至少一张 APNG 或 GIF 动图" }); return; }
    updateNodeData(nodeId, { busy: true, statusMessage: restore ? "正在恢复拆帧结果…" : `正在拆解 ${assetIds.length} 张动图…` });
    try {
      const response = restore
        ? await fetch(`/api/frame-extraction/tasks/${encodeURIComponent(restore.id)}`, { cache: "no-store" })
        : await fetch("/api/frame-extraction/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, assetIds, taskId: processor.data.frameTask?.id }) });
      const payload = await response.json() as { task?: FrameExtractionTask; error?: string };
      if (restore && response.status === 404) {
        throw new Error("原拆帧记录已不存在，请检查项目数据目录");
      }
      if (!response.ok || !payload.task || payload.task.projectId !== projectId) throw new Error(payload.error ?? "读取拆帧结果失败");
      const task = payload.task;
      if (restore && !task.sources.some((source) => source.status !== "failed")) {
        throw new Error("当前任务没有可恢复的拆帧结果");
      }
      const resultEdge = edges.find((edge) => edge.source === nodeId && edge.sourceHandle === "frame-sequences");
      const existingResult = (resultEdge ? nodes.find((node) => node.id === resultEdge.target) : undefined)
        ?? nodes.find((node) => node.type === "group" && node.data.frameTask?.id === task.id);
      const existingResultId = (isModuleNode(existingResult) && existingResult.data.moduleType === "frame-result")
        || (existingResult?.type === "group" && existingResult.data.frameTask) ? existingResult.id : undefined;
      const resultId = existingResultId ?? `frame-batch-${crypto.randomUUID()}`;
      setNodes((current) => {
        const updated = current.map((node) => {
          if (node.id === nodeId && isModuleNode(node)) return { ...node, data: { ...node.data, busy: false, statusMessage: task.status === "failed" ? "本次拆帧失败" : task.status === "partial" ? "部分素材拆解失败" : "拆帧完成", frameTask: task } };
          if (node.id === existingResultId && isModuleNode(node)) return { ...node, data: { ...node.data, frameTask: task } };
          return node;
        });
        const origin = flowRef.current?.getInternalNode(nodeId)?.internals.positionAbsolute ?? processor.position;
        const resultNode = updated.find((node) => node.id === resultId);
        if (resultNode?.type === "group") return syncFrameBatch(updated, resultNode, task);
        if (existingResultId || task.status === "failed") return updated;
        return syncFrameBatch(updated, { id: resultId, type: "group", position: { x: origin.x + 360, y: origin.y - 40 }, data: { label: "动画帧批次" } }, task);
      });
      if (resultEdge?.target !== resultId && task.status !== "failed") setEdges((currentEdges) => addEdge({ id: `frame-result-edge-${crypto.randomUUID()}`, source: nodeId, sourceHandle: "frame-sequences", target: resultId, targetHandle: "source-task", type: "default" }, currentEdges));
    } catch (error) {
      updateNodeData(nodeId, { busy: false, statusMessage: error instanceof Error ? error.message : "拆帧失败" });
    }
  }, [edges, frameInputKey, nodes, projectId, setEdges, setNodes, updateNodeData]);

  const readOrderedGroup = useCallback((groupId: string): FrameExtractionTask | undefined => {
    if (!reviewRevision) return;
    const group = nodes.find((node) => node.id === groupId);
    if (group?.type !== "group" || group.data.frameTask || group.data.frameSourceId || !group.data.orderedChildIds?.length) return;
    const children = nodes.filter((node) => node.parentId === groupId);
    if (orderedMembersError(children, staticReviews.current)) return;
    const byId = new Map(children.map((node) => [node.id, node]));
    const members = group.data.orderedChildIds.map((id) => byId.get(id));
    if (children.length !== members.length || !members.every((node) => isModuleNode(node) && node.data.moduleType === "image" && node.data.previewUrl)) return;
    let elapsed = 0;
    const frames = members.flatMap((node, position) => {
      if (!isModuleNode(node) || !node.data.previewUrl) return [];
      const durationMs = group.data.frameDurationsMs?.[node.id] ?? 100;
      const frame = { id: node.id, assetId: node.data.assetId, position, sourcePosition: position,
        timelineStartMs: elapsed, durationMs, previewUrl: node.data.previewUrl, retained: true };
      elapsed += durationMs;
      return [frame];
    });
    return { id: `ordered-${groupId}`, projectId, status: "ready", expiresAt: "", sources: [{
      id: groupId, manualGroupId: groupId, sourceAssetId: "", name: group.data.label, position: 0, status: "ready",
      width: null, height: null, totalDurationMs: elapsed, collectionId: null, errorCode: null, errorMessage: null, frames,
    }] };
  }, [nodes, projectId, reviewRevision]);

  const readFrameTasks = useCallback((nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!isModuleNode(node)) return [];
    if (node.data.moduleType === "frame-result" || node.data.moduleType === "frame-stitch") {
      const tasks = new Map<string, FrameExtractionTask>();
      for (const edge of edges.filter((item) => item.target === nodeId && item.targetHandle === "source-task")) {
        const source = nodes.find((item) => item.id === edge.source);
        const batch = source?.type === "group" && source.data.frameSourceId
          ? nodes.find((item) => item.id === source.parentId) : source;
        if (batch?.type !== "group" || !batch.data.frameTask) {
          if (node.data.moduleType === "frame-result" && isModuleNode(source) && source.data.frameTask) {
            tasks.set(source.data.frameTask.id, source.data.frameTask);
          }
          if (node.data.moduleType === "frame-result" && source?.type === "group") {
            const ordered = readOrderedGroup(source.id);
            if (ordered) tasks.set(ordered.id, ordered);
          }
          continue;
        }
        const task = batch.data.frameTask;
        if (source?.type === "group" && source.data.frameSourceId) {
          const existing = tasks.get(task.id);
          if (existing?.sources.length === task.sources.length) continue;
          const selected = task.sources.find((item) => item.id === source.data.frameSourceId);
          if (selected && !existing?.sources.some((item) => item.id === selected.id))
            tasks.set(task.id, { ...task, sources: [...(existing?.sources ?? []), selected] });
        } else tasks.set(task.id, task);
      }
      return [...tasks.values()];
    }
    return node.data.frameTask ? [node.data.frameTask] : [];
  }, [edges, nodes, readOrderedGroup]);

  const readFrameTask = useCallback((nodeId: string, sourceId?: string) => {
    const tasks = readFrameTasks(nodeId);
    return sourceId ? tasks.find((task) => task.sources.some((source) => source.id === sourceId)) : tasks[0];
  }, [readFrameTasks]);

  const updateFrameDraft = useCallback((_nodeId: string, task: FrameExtractionTask) => {
    setNodes((current) => {
      let next = current.map((node) => isModuleNode(node) && node.data.frameTask?.id === task.id
        ? { ...node, data: { ...node.data, frameTask: task } } : node);
      for (const node of current) {
        if (node.type === "group" && node.data.frameTask?.id === task.id) {
          const changed = new Map(task.sources.map((source) => [source.id, source]));
          const sources = node.data.frameTask.sources.map((source) => changed.get(source.id) ?? source);
          next = syncFrameBatch(next, node, { ...task, sources });
        }
      }
      return next;
    });
  }, [setNodes]);

  const openBatchEditor = useCallback((batchId: string, type: "frame-result" | "frame-stitch" = "frame-result") => {
    const batch = nodes.find((node) => node.id === batchId);
    if (batch?.type !== "group" || !batch.data.frameTask) return;
    const existing = edges.find((edge) => edge.source === batchId && nodes.some((node) =>
      node.id === edge.target && isModuleNode(node) && node.data.moduleType === type));
    const id = existing?.target ?? `frame-editor-${crypto.randomUUID()}`;
    if (!existing) {
      commitPendingHistory();
      const origin = flowRef.current?.getInternalNode(batchId)?.internals.positionAbsolute ?? batch.position;
      const siblings = nodes.filter((node) => edges.some((edge) => edge.source === batchId && edge.target === node.id));
      const y = Math.max(origin.y, ...siblings.map((node) => node.position.y + Number(node.measured?.height ?? node.style?.height ?? 360) + 48));
      const editor = materialNode(type, { x: origin.x + Number(batchLayout.sizes.get(batchId)?.width ?? batch.style?.width ?? 440) + 80, y });
      editor.id = id;
      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), editor]);
      setEdges((current) => addEdge({ source: batchId, sourceHandle: "sequences", target: id, targetHandle: "source-task", type: "default" }, current));
    } else {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
    }
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id }], duration: 350, padding: .3, maxZoom: 1 }), 80);
  }, [batchLayout, commitPendingHistory, edges, nodes, setEdges, setNodes]);

  const placeStitchResults = useCallback((nodeId: string, outputs: StitchOutput[]) => {
    const processor = flowRef.current?.getInternalNode(nodeId);
    if (!processor || !outputs.length) return;
    const groupId = `stitch-results-${crypto.randomUUID()}`;
    const origin = processor.internals.positionAbsolute;
    const columns = Math.min(3, outputs.length);
    const oldGroups = edges.filter((edge) => edge.source === nodeId && edge.sourceHandle === "stitched-images")
      .map((edge) => nodes.find((node) => node.id === edge.target)).filter((node) => node !== undefined);
    const y = Math.max(origin.y, ...oldGroups.map((node) => node.position.y + Number(node.style?.height ?? 240) + 40));
    const group: CanvasNode = { id: groupId, type: "group", position: { x: origin.x + 380, y },
      style: { width: columns * 250 + 32, height: Math.ceil(outputs.length / columns) * 200 + 56 }, data: { label: "拼接结果组", stitchResult: true } };
    const children: CanvasModuleNode[] = outputs.map((asset, index) => ({
      id: `stitch-image-${crypto.randomUUID()}`, type: "module", parentId: groupId,
      position: { x: 24 + index % columns * 250, y: 42 + Math.floor(index / columns) * 200 },
      style: { width: 222, height: 170 },
      data: { moduleType: "image", title: asset.name, previewUrl: asset.previewUrl, assetId: asset.id,
        derivationId: asset.derivationId, naturalSizeApplied: true },
    }));
    commitPendingHistory();
    setNodes((current) => parentsFirst([...current, group, ...children]));
    setEdges((current) => addEdge({ source: nodeId, sourceHandle: "stitched-images", target: groupId, targetHandle: stitchResultPort.id, type: "default" }, current));
    onAssetImported();
  }, [commitPendingHistory, edges, nodes, onAssetImported, setEdges, setNodes]);
  const openFrameViewer = useCallback((nodeId: string, sourceId: string) => setViewer({ nodeId, sourceId }), []);

  const placeSequence = useCallback(async (sequence: { id: string; name: string; frames: Array<{ id: string; name: string; previewUrl: string | null; durationMs?: number }> }, base: { x: number; y: number }) => {
    if (!sequence.frames.length) return;
    try {
      await reviewStaticMembers(sequence.frames.map((frame): CanvasNode => ({
        id: frame.id, type: "module", position: { x: 0, y: 0 },
        data: { moduleType: "image", assetId: frame.id, previewUrl: frame.previewUrl ?? undefined, title: frame.name },
      })));
    } catch (error) { setConnectionNotice(error instanceof Error ? error.message : "无法加入序列"); return; }
    const columns = Math.min(6, Math.ceil(Math.sqrt(sequence.frames.length)));
    const groupId = `sequence-group-${crypto.randomUUID()}`;
    const group: CanvasNode = { id: groupId, type: "group", position: base,
      style: { width: columns * 150 + 30, height: Math.ceil(sequence.frames.length / columns) * 150 + 60 },
      data: { label: `${sequence.name} · ${sequence.frames.length} 帧`, sequenceId: sequence.id } };
    const children: CanvasModuleNode[] = sequence.frames.map((asset, index) => ({
      id: `frame-asset-${crypto.randomUUID()}`, type: "module", parentId: groupId, extent: "parent",
      position: { x: 18 + (index % columns) * 150, y: 38 + Math.floor(index / columns) * 150 },
      style: { width: 132, height: 132 },
      data: { moduleType: "image", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined,
        title: `${String(index + 1).padStart(3, "0")} · ${asset.name}`, naturalSizeApplied: true },
    }));
    group.data.orderedChildIds = children.map((child) => child.id);
    group.data.frameDurationsMs = Object.fromEntries(children.map((child, index) => [child.id,
      Math.max(1, Math.min(3600000, Math.round(sequence.frames[index].durationMs ?? 100)))]));
    commitPendingHistory();
    setNodes((current) => parentsFirst(current.concat(group, ...children)));
    return groupId;
  }, [commitPendingHistory, reviewStaticMembers, setNodes]);

  const materializeFrameSequence = useCallback(async (nodeId: string, sourceId: string) => {
    const result = nodes.find((node) => node.id === nodeId);
    const task = readFrameTask(nodeId, sourceId);
    if (!isModuleNode(result) || !task) return;
    let sequence = result.data.savedSequences?.[sourceId];
    if (!sequence) {
      const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${sourceId}/save`, { method: "POST" });
      const payload = await response.json() as { sequence?: SavedFrameSequence; error?: string };
      if (!response.ok || !payload.sequence) { updateNodeData(nodeId, { statusMessage: payload.error ?? "保存序列失败" }); return; }
      sequence = payload.sequence;
      updateNodeData(nodeId, { savedSequences: { ...result.data.savedSequences, [sourceId]: sequence }, statusMessage: "序列已保存" });
      const collectionId = sequence.collectionId;
      updateFrameDraft(nodeId, { ...task, sources: task.sources.map((source) => source.id === sourceId
        ? { ...source, status: "saved", collectionId, frames: source.frames.filter((frame) => frame.retained) } : source) });
    }
    const instance = flowRef.current;
    if (!instance) return;
    const base = { x: result.position.x + 30, y: result.position.y + 560 };
    const groupId = await placeSequence({ id: sequence.collectionId, name: sequence.name, frames: sequence.assets }, base);
    onAssetImported();
    if (groupId) window.setTimeout(() => void instance.fitView({ nodes: [{ id: groupId }], duration: 450, padding: .35, maxZoom: 1 }), 50);
  }, [nodes, onAssetImported, placeSequence, readFrameTask, updateFrameDraft, updateNodeData]);

  const copyFrameGroup = useCallback(async (groupId: string) => {
    const group = nodes.find((node) => node.id === groupId);
    const batch = group?.parentId ? nodes.find((node) => node.id === group.parentId) : undefined;
    if (group?.type !== "group" || !group.data.frameSourceId || batch?.type !== "group" || !batch.data.frameTask) return;
    const sourceId = group.data.frameSourceId;
    const task = batch.data.frameTask;
    const response = await fetch(`/api/frame-extraction/tasks/${task.id}/sources/${sourceId}/save`, { method: "POST" });
    const payload = await response.json() as { sequence?: SavedFrameSequence; error?: string };
    if (!response.ok || !payload.sequence) throw new Error(payload.error ?? "保存序列失败");
    updateFrameDraft(batch.id, { ...task, sources: task.sources.map((source) => source.id === sourceId
      ? { ...source, status: "saved", collectionId: payload.sequence!.collectionId } : source) });
    const origin = flowRef.current?.getInternalNode(batch.id)?.internals.positionAbsolute ?? batch.position;
    const visibleHeight = batchLayout.sizes.get(batch.id)?.height ?? frameBatchCompactSize(nodes, batch.id).height;
    const copiedId = await placeSequence({ id: payload.sequence.collectionId, name: payload.sequence.name, frames: payload.sequence.assets },
      { x: origin.x, y: origin.y + visibleHeight + 64 });
    onAssetImported();
    if (copiedId) window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id: copiedId }], duration: 350, padding: .35, maxZoom: 1 }), 50);
  }, [batchLayout.sizes, nodes, onAssetImported, placeSequence, updateFrameDraft]);

  const duplicateImage = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((node) => node.id === nodeId);
    if (!isModuleNode(node) || node.data.moduleType !== "image") return;
    const parent = nodesRef.current.find((group) => group.id === node.parentId);
    if (parent?.type === "group" && parent.data.frameSourceId) return;
    const copy: CanvasModuleNode = { ...node, id: `image-copy-${crypto.randomUUID()}`, selected: true,
      measured: undefined, width: undefined, height: undefined, dragging: false,
      data: { ...node.data }, position: { x: node.position.x + 28, y: node.position.y + 28 } };
    commitPendingHistory();
    setNodes((current) => {
      const next = current.map((item) => {
        if (item.id === node.parentId && isOrderedGroup(item)) {
          const order = [...item.data.orderedChildIds!];
          order.splice(order.indexOf(nodeId) + 1, 0, copy.id);
          return { ...item, selected: false, data: { ...item.data, orderedChildIds: order,
            frameDurationsMs: { ...item.data.frameDurationsMs, [copy.id]: item.data.frameDurationsMs?.[nodeId] ?? 100 } } };
        }
        return item.selected ? { ...item, selected: false } : item;
      }).concat(copy);
      return isOrderedGroup(parent) ? layoutOrderedForMode(next, parent.id) : next;
    });
  }, [commitPendingHistory, setNodes]);

  const groupMembers = useCallback((groupId: string) => nodes.filter((node) => node.parentId === groupId)
    .map((node) => ({ id: node.id, moduleType: node.type === "module" ? node.data.moduleType : undefined,
      title: node.type === "module" ? node.data.title ?? "图片" : node.data.label,
      previewUrl: node.type === "module" && node.data.moduleType === "image" ? node.data.previewUrl : undefined })), [nodes]);
  const readGroupExport = useCallback((groupId: string) => groupExportManifest(nodes, groupId), [nodes]);
  const setGroupOrdered = useCallback(async (groupId: string) => {
    const group = nodesRef.current.find((node) => node.id === groupId);
    if (group?.type !== "group" || group.data.frameTask || group.data.frameSourceId) return;
    if (isOrderedGroup(group)) {
      commitPendingHistory();
      setNodes((current) => current.map((node) => node.id === groupId && node.type === "group"
        ? { ...node, data: { ...node.data, orderedChildIds: undefined, frameDurationsMs: undefined } } : node));
      return;
    }
    try {
      const members = nodesRef.current.filter((node) => node.parentId === groupId);
      await reviewStaticMembers(members);
      commitPendingHistory();
      setNodes((current) => {
        const children = current.filter((node) => node.parentId === groupId);
        if (orderedMembersError(children, staticReviews.current)) return current;
        return layoutOrderedGroup(current.map((node) => node.id === groupId && node.type === "group"
          ? { ...node, data: { ...node.data, orderedChildIds: initialFrameOrder(children), resizeMode: "reflow", scaleBase: undefined } } : node), groupId, undefined, true);
      });
    } catch (error) { setConnectionNotice(error instanceof Error ? error.message : "无法设为有序组"); }
  }, [commitPendingHistory, reviewStaticMembers, setNodes]);
  const setFrameDuration = useCallback((groupId: string, memberId: string, durationMs: number, applyAll = false) => {
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 3600000) return;
    commitPendingHistory();
    setNodes((current) => current.map((node) => node.id === groupId && node.type === "group" && node.data.orderedChildIds?.includes(memberId)
      && (applyAll || (node.data.frameDurationsMs?.[memberId] ?? 100) !== durationMs)
      ? { ...node, data: { ...node.data, frameDurationsMs: applyAll ? Object.fromEntries(node.data.orderedChildIds!.map((id) => [id, durationMs])) : { ...node.data.frameDurationsMs, [memberId]: durationMs } } } : node));
  }, [commitPendingHistory, setNodes]);
  const updateOrderedFrames = useCallback((groupId: string, orderedIds: string[]) => {
    commitPendingHistory();
    setNodes((current) => {
      const group = current.find((node) => node.id === groupId);
      if (group?.type !== "group" || !group.data.orderedChildIds || !orderedIds.length
        || orderedIds.some((id) => !group.data.orderedChildIds?.includes(id))) return current;
      const byId = new Map(current.map((node) => [node.id, node]));
      const retained = new Set(orderedIds);
      const durations = Object.fromEntries(Object.entries(group.data.frameDurationsMs ?? {}).filter(([id]) => retained.has(id)));
      const updated = current.flatMap((node) => {
        if (node.id === groupId) return [{ ...group, data: { ...group.data, orderedChildIds: orderedIds, frameDurationsMs: durations } }];
        if (node.parentId !== groupId || retained.has(node.id)) return [node];
        return [{ ...node, parentId: undefined, extent: undefined, position: worldPosition(node, byId) }];
      });
      return layoutOrderedForMode(updated, groupId);
    });
  }, [commitPendingHistory, setNodes]);

  const frameInputWarnings = useCallback((nodeId: string) => edges.filter((edge) => edge.target === nodeId && edge.sourceHandle === "group-materials")
    .flatMap((edge) => {
      const group = nodes.find((node) => node.id === edge.source);
      return group?.type === "group" && !readOrderedGroup(group.id)
        ? [`${group.data.label}：请设为有序组，并确保组内都是可预览的图片。`] : [];
    }), [edges, nodes, readOrderedGroup]);
  const previewOrderedGroup = useCallback((groupId: string) => {
    void reviewStaticMembers(nodesRef.current.filter((node) => node.parentId === groupId))
      .then(() => setOrderedPreviewGroupId(groupId))
      .catch((error: unknown) => setConnectionNotice(error instanceof Error ? error.message : "无法播放有序组"));
  }, [reviewStaticMembers]);

  const { upload: uploadVideo, dialog: videoImportDialog } = useVideoImport(projectId, setConnectionNotice);
  const importVideo = useCallback(async (nodeId: string, file: File, placement?: CanvasModuleNode) => {
    const targetNode = nodesRef.current.find((node) => node.id === nodeId) ?? placement;
    if (!targetNode) return false;
    const parent = nodesRef.current.find((node) => node.id === targetNode.parentId);
    if (isOrderedGroup(parent)) { setConnectionNotice("有序组只能放入静态图片，视频请放在画布空白处或普通组中"); return false; }
    if (!placement) updateNodeData(nodeId, { busy: true });
    const imported = await uploadVideo(file);
    if (!placement) updateNodeData(nodeId, { busy: false });
    if (!imported) return false;
    const { asset } = imported;
    if (imported.editor) {
      onAssetImported();
      navigate(`/video-editor/${encodeURIComponent(projectId)}/${encodeURIComponent(asset.id)}`, "正在打开视频观察页");
      return true;
    }
    commitPendingHistory();
    setNodes((current) => {
      const existing = current.find((node) => node.id === nodeId);
      if (!existing && !placement) return current;
      const base = existing ?? placement!;
      const parent = current.find((node) => node.id === base.parentId);
      if (isOrderedGroup(parent)) return current;
      const node: CanvasModuleNode = { ...base, type: "module",
        parentId: parent?.id, position: base.parentId && !parent ? targetNode.position : base.position,
        style: { width: 320, height: Math.max(120, Math.min(480, Math.round(320 * (asset.height ?? 180) / (asset.width ?? 320)))) },
        data: { moduleType: "video", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined, title: asset.name,
          detail: `${asset.width} × ${asset.height} px · ${asset.duration?.toFixed(1)} 秒 · ${((asset.size ?? 0) / 1024 / 1024).toFixed(1)} MiB · 资产库` } };
      return existing ? current.map((item) => item.id === nodeId ? node : item) : parentsFirst(current.concat(node));
    });
    onAssetImported();
    return true;
  }, [commitPendingHistory, onAssetImported, projectId, navigate, setNodes, updateNodeData, uploadVideo]);

  const uploadImages = useCallback(async (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body: formData });
    const payload = await response.json() as { assets?: AssetSummary[]; importedIds?: string[]; error?: string };
    if (!response.ok || !payload.assets || payload.importedIds?.length !== files.length) throw new Error(payload.error ?? "导入图片失败");
    const imported = payload.importedIds.map((id) => payload.assets!.find((item) => item.id === id));
    if (imported.some((item) => !item)) throw new Error("导入完成但没有找到图片资产");
    return imported.map((asset) => asset!);
  }, [projectId]);

  const importImage = useCallback(async (nodeId: string, files: File[], placement?: CanvasModuleNode) => {
    if (!files.length) return;
    if (placement) setConnectionNotice("正在导入图片…");
    else updateNodeData(nodeId, { busy: true, statusMessage: undefined });
    try {
      const assets = await uploadImages(files);
      if (placement) setConnectionNotice("");
      const currentPlaceholder = nodesRef.current.find((node) => node.id === nodeId) ?? placement;
      const parent = nodesRef.current.find((node) => node.id === currentPlaceholder?.parentId);
      if (placement?.parentId && !parent) throw new Error("目标组已被移除，图片已加入资产库，请重新放入画布。");
      if (isOrderedGroup(parent)) await reviewStaticMembers(assets.map((asset, index): CanvasNode => ({
        id: `check-${index}`, type: "module", position: { x: 0, y: 0 },
        data: { moduleType: "image", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined, title: asset.name },
      })));
      let order = imageImportOrder(files.map((file) => file.name));
      if (order && !isOrderedGroup(parent)) {
        try {
          await reviewStaticMembers(assets.map((asset): CanvasNode => ({
            id: asset.id, type: "module", position: { x: 0, y: 0 },
            data: { moduleType: "image", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined, title: asset.name },
          })));
        } catch (error) {
          setConnectionNotice(error instanceof Error ? error.message : "这些图片暂无法组成有序组");
          order = null;
        }
      }
      const arranged = (order ?? files.map((_, index) => index)).map((index) => assets[index]!);
      const grouped = !isOrderedGroup(parent) && (Boolean(order) || arranged.length >= 8);
      commitPendingHistory();
      setNodes((current) => {
        const placeholder = current.find((node) => node.id === nodeId) ?? placement;
        if (!isModuleNode(placeholder) || placeholder.data.moduleType !== "image") return current;
        const currentParent = current.find((node) => node.id === placeholder.parentId);
        if (placement?.parentId && !currentParent) return current;
        if (isOrderedGroup(currentParent) && assets.some((asset) => staticReviews.current.get(asset.id)?.status !== "static")) return current;
        const columns = Math.min(4, Math.ceil(Math.sqrt(arranged.length)));
        const groupId = `import-group-${crypto.randomUUID()}`;
        const groupPosition = { x: placeholder.position.x - 20, y: placeholder.position.y - 38 };
        const imageNodes: CanvasModuleNode[] = arranged.map((asset, index) => ({
          ...placeholder,
          id: index === 0 ? nodeId : `asset-${asset.id}-${crypto.randomUUID()}`,
          measured: undefined, width: undefined, height: undefined, dragging: false,
          parentId: grouped ? groupId : placeholder.parentId,
          position: grouped ? { x: 20 + index % columns * 280, y: 38 + Math.floor(index / columns) * 244 }
            : { x: placeholder.position.x + index % columns * 280, y: placeholder.position.y + Math.floor(index / columns) * 244 },
          style: { width: 260, height: 220 }, selected: false,
          data: { moduleType: "image", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined,
            title: files[order?.[index] ?? index].name, detail: asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · 资产库` : "资产库",
            naturalSizeApplied: false },
        }));
        if (!grouped) {
          let next = current.filter((node) => node.id !== nodeId).concat(imageNodes);
          if (isOrderedGroup(currentParent)) {
            next = next.map((node) => {
              if (node.id !== currentParent.id || node.type !== "group") return node;
              const orderedIds = [...currentParent.data.orderedChildIds!];
              const index = orderedIds.indexOf(nodeId);
              orderedIds.splice(index < 0 ? orderedIds.length : index, index < 0 ? 0 : 1, ...imageNodes.map((image) => image.id));
              return { ...node, data: { ...node.data, orderedChildIds: orderedIds } };
            });
            next = layoutOrderedForMode(next, currentParent.id);
          }
          return parentsFirst(next);
        }
        const group: CanvasNode = { id: groupId, type: "group", parentId: placeholder.parentId, position: groupPosition, selected: true,
          style: { width: columns * 280 + 16, height: Math.ceil(arranged.length / columns) * 244 + 30 },
          data: { label: `${order ? "有序组" : "组"} · ${arranged.length} 项`, ...(order ? { orderedChildIds: imageNodes.map((node) => node.id) } : {}) } };
        return parentsFirst(current.filter((node) => node.id !== nodeId).concat(group, ...imageNodes));
      });
      onAssetImported();
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入图片失败";
      if (placement) { setConnectionNotice(message); onAssetImported(); }
      else updateNodeData(nodeId, { busy: false, statusMessage: message });
    }
  }, [commitPendingHistory, onAssetImported, reviewStaticMembers, setNodes, updateNodeData, uploadImages]);

  const toggleGroup = useCallback((groupId: string) => {
    commitPendingHistory();
    const group = nodes.find((node) => node.id === groupId);
    if (group?.type === "group" && group.data.collapsed) setGroupTransition({ id: groupId, kind: "expand" });
    setNodes((current) => {
      const next = current.map((node) => node.id === groupId && node.type === "group"
        ? { ...node, data: { ...node.data, collapsed: !node.data.collapsed } }
        : node.type === "group" && node.data.frameSourceId && group?.type === "group" && group.data.frameSourceId
          && group.data.collapsed && group.parentId === node.parentId
          ? { ...node, selected: false, data: { ...node.data, collapsed: true } }
          : node.selected ? { ...node, selected: false } : node);
      const opened = next.find((node) => node.id === groupId);
      return opened?.type === "group" && !opened.data.collapsed && opened.data.resizeMode === "scale"
        ? containGroupMembers(next, groupId, { width: Number(opened.style?.width ?? opened.width ?? 440),
          height: Number(opened.style?.height ?? opened.height ?? 300) }) : next;
    });
  }, [commitPendingHistory, nodes, setNodes]);
  const arrangeGroup = useCallback(async (groupId: string) => {
    if (isOrderedGroup(nodesRef.current.find((node) => node.id === groupId))) {
      await reviewStaticMembers(nodesRef.current.filter((node) => node.parentId === groupId));
      commitPendingHistory();
      setNodes((current) => {
        const group = current.find((node) => node.id === groupId);
        return group?.type === "group" && group.data.resizeMode === "scale"
          ? containGroupMembers(current, groupId, { width: Number(group.style?.width ?? group.width ?? 440),
            height: Number(group.style?.height ?? group.height ?? 300) })
          : layoutOrderedGroup(current, groupId, undefined, true);
      });
      return;
    }
    const assetIds = [...new Set(nodes.flatMap((node) => node.parentId === groupId && isModuleNode(node)
      && node.data.moduleType === "image" && node.data.assetId ? [node.data.assetId] : []))];
    const animated = new Map<string, boolean>();
    for (let offset = 0; offset < assetIds.length; offset += 500) {
      const response = await fetch("/api/frame-extraction/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, assetIds: assetIds.slice(offset, offset + 500) }),
      });
      const payload = await response.json() as { items?: FrameInputReview[]; error?: string };
      if (!response.ok || !payload.items) throw new Error(payload.error ?? "图片分类失败，请重试");
      for (const item of payload.items) if (item.status !== "unavailable") animated.set(item.assetId, item.status !== "static");
    }
    commitPendingHistory();
    setNodes((current) => {
      const group = current.find((node) => node.id === groupId);
      if (group?.type !== "group" || group.data.collapsed || group.data.frameTask || group.data.frameSourceId) return current;
      const children = current.filter((node) => node.parentId === groupId);
      if (!children.length) return current;
      const layout = arrangeGroupChildren(children, animated, Math.max(600, Number(group.width ?? group.measured?.width ?? group.style?.width ?? 600)));
      const arranged = new Map(layout.nodes.map((node) => [node.id, node]));
      return current.map((node) => node.id === groupId && node.type === "group" ? {
        ...node, width: undefined, height: undefined, style: { ...node.style, width: layout.width, height: layout.height },
        data: node.data.resizeMode === "scale" ? { ...node.data,
          scaleBase: Object.fromEntries(layout.nodes.filter((child) => child.parentId === groupId).map((child) => [child.id, {
            width: Number(child.style?.width ?? child.width ?? 180), height: Number(child.style?.height ?? child.height ?? 146),
          }])) } : node.data,
      } : arranged.get(node.id) ?? node);
    });
  }, [commitPendingHistory, nodes, projectId, reviewStaticMembers, setNodes]);
  const finishGroupResize = useCallback((groupId: string, width: number, height: number) => {
    setNodes((current) => containGroupMembers(current, groupId, { width, height }));
  }, [setNodes]);
  const toggleGroupContentScale = useCallback(() => {
    commitPendingHistory();
    const nextEnabled = !groupContentScaleEnabled;
    setGroupContentScaleEnabled(nextEnabled);
    setNodes((current) => setAllGroupResizeModes(current, nextEnabled ? "scale" : "reflow"));
  }, [commitPendingHistory, groupContentScaleEnabled, setNodes]);
  const nodeActions = useMemo(() => ({ videoInputKey, openVideoFrameExtraction, attachVideoFrameTask, duplicateImage, openCropSetup, placeStitchResults, arrangeGroup, finishGroupResize, groupContentScaleEnabled, toggleGroupContentScale, frameInputKey, projectId, groupSelection: () => addNode("group"), createOrderedGroup, importImage, importVideo, materializeFrameSequence, copyFrameGroup, groupMembers, groupExportManifest: readGroupExport, setGroupOrdered, setFrameDuration, previewOrderedGroup, openFrameViewer, startFrameExtraction, ungroupNode, updateFrameDraft, updateNodeData, toggleGroup, groupCovers: covers, readFrameTask, readFrameTasks, frameInputWarnings, updateOrderedFrames, openBatchEditor, refreshAssets: onAssetImported }), [videoInputKey, openVideoFrameExtraction, attachVideoFrameTask, addNode, duplicateImage, openCropSetup, createOrderedGroup, placeStitchResults, arrangeGroup, finishGroupResize, groupContentScaleEnabled, toggleGroupContentScale, frameInputKey, projectId, importImage, importVideo, materializeFrameSequence, copyFrameGroup, groupMembers, readGroupExport, setGroupOrdered, setFrameDuration, previewOrderedGroup, openFrameViewer, startFrameExtraction, ungroupNode, updateFrameDraft, updateNodeData, toggleGroup, covers, readFrameTask, readFrameTasks, frameInputWarnings, updateOrderedFrames, openBatchEditor, onAssetImported]);
  const selectedNodes = nodes.filter((node) => node.selected && !hiddenBy.has(node.id));
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const selectionRoots = selectedNodes.filter((node) => {
    let parentId = node.parentId;
    while (parentId) {
      if (selectedIds.has(parentId)) return false;
      parentId = nodesById.get(parentId)?.parentId;
    }
    return true;
  });
  const selectedGroups = selectionRoots.filter((node) => node.type === "group");
  const canCombine = selectedGroups.length >= 2 && selectedGroups.length === selectionRoots.length
    && selectedGroups.every((group) => !group.data.frameTask && !group.data.frameSourceId && group.parentId === selectedGroups[0].parentId);
  const applyGroupCombination = (operation: "merge" | "nest") => {
    if (!canCombine) return;
    if (operation === "merge" && edges.some((edge) => selectedGroups.some((group) => group.id === edge.source))
      && !window.confirm("合并后，原组连到的下游节点将收到合并后的全部组内素材。继续合并吗？")) return;
    commitPendingHistory();
    const id = `group-${crypto.randomUUID()}`;
    const next = combineGroups(nodes, edges, selectedGroups, operation, id);
    setGroupTransition({ id, kind: operation });
    setNodes(next.nodes);
    setEdges(next.edges);
  };
  const canGroup = selectedNodes.filter((node) => !node.parentId && node.type !== "group").length >= 2;
  const canOrderedGroup = selectedNodes.filter((node) => !node.parentId && node.type === "module" && node.data.moduleType === "image" && node.data.assetId).length >= 2
    && selectedNodes.every((node) => !node.parentId && node.type === "module" && node.data.moduleType === "image" && Boolean(node.data.assetId));

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE) && !event.dataTransfer.types.includes(SEQUENCE_DRAG_TYPE)
      && !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const insertAsset = useCallback(async (asset: AssetSummary, position: { x: number; y: number }, allowGroup: boolean) => {
    if (asset.type !== "image" && asset.type !== "video") return;
    if (asset.type === "video" && !asset.clip && needsVideoEditor(asset.size ?? 0, asset.duration ?? 0)) {
      if (window.confirm("此视频超过 5 分钟或 500 MiB。点击“确定”进入视频编辑，点击“取消”仍放到画布。")) {
        navigate(`/video-editor/${encodeURIComponent(projectId)}/${encodeURIComponent(asset.id)}`, "正在打开视频观察页");
        return;
      }
    }
    const target = allowGroup ? groupAtPoint(nodesRef.current, position) : undefined;
    if (isOrderedGroup(target)) {
      if (asset.type === "video") { setConnectionNotice("有序组只能放入静态图片"); return; }
      try {
        await reviewStaticMembers([{ id: "check", type: "module", position, data: {
          moduleType: "image", assetId: asset.id, previewUrl: asset.previewUrl ?? undefined, title: asset.name,
        } }]);
      } catch (error) { setConnectionNotice(error instanceof Error ? error.message : "无法加入有序组"); return; }
    }
  setNodes((current) => {
    let placement = position;
    if (!allowGroup) {
      const step = 24 / (flowRef.current?.getZoom() ?? 1);
      let offset = 0;
      while (current.some((node) => !node.parentId && node.type === "module" && node.data.moduleType === "image"
        && Math.abs(node.position.x - position.x - offset) < step / 2
        && Math.abs(node.position.y - position.y - offset) < step / 2)) {
        offset += step;
      }
      placement = { x: position.x + offset, y: position.y + offset };
    }
    const group = allowGroup ? groupAtPoint(current, position) : undefined;
    if (isOrderedGroup(group) && staticReviews.current.get(asset.id)?.status !== "static") return current;
    const node: CanvasModuleNode = {
      id: `asset-${asset.id}-${crypto.randomUUID()}`,
      type: "module",
      position: group ? { x: position.x - group.position.x, y: position.y - group.position.y } : placement,
      parentId: group?.id,
      extent: undefined,
      style: asset.type === "video" ? { width: 320, height: Math.max(120, Math.min(480, Math.round(320 * (asset.height ?? 180) / (asset.width ?? 320)))) } : { height: 190, width: 240 },
      data: {
        moduleType: asset.type === "video" ? "video" : "image",
        assetId: asset.id,
        clip: asset.clip,
        previewUrl: asset.previewUrl ?? undefined,
        title: asset.name,
        detail: asset.type === "video" ? `${asset.width} × ${asset.height} px · ${asset.duration?.toFixed(1)} 秒 · 资产库` : asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · 资产库` : "资产库",
      },
    };
    if (!group) return current.concat(node);
    return parentsFirst(current.map((item) => item.id === group.id && item.type === "group" && item.data.orderedChildIds
      ? { ...item, data: { ...item.data, orderedChildIds: [...item.data.orderedChildIds, node.id] } } : item).concat(node));
  });
  }, [projectId, reviewStaticMembers, navigate, setNodes]);

  const placeAsset = useCallback((asset: AssetSummary) => {
    const flow = flowRef.current;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!flow || !bounds) return;
    const center = flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    insertAsset(asset, { x: center.x - 120, y: center.y - 95 }, false);
  }, [insertAsset]);

  useEffect(() => {
    const key = `mowo:place-video-clip:${projectId}`;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (!flowRef.current || !surfaceRef.current) {
        if (++attempts > 30) window.clearInterval(timer);
        return;
      }
      window.clearInterval(timer);
      try {
        const serialized = sessionStorage.getItem(key);
        if (!serialized) return;
        sessionStorage.removeItem(key);
        const asset = JSON.parse(serialized) as AssetSummary;
        if (asset.clip && asset.type === "video") placeAsset(asset);
      } catch { setConnectionNotice("片段已保存，但自动放入画布失败；可从素材库拖入"); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [placeAsset, projectId]);

  const clipboardRef = useRef<{ token: string; fragment: ReturnType<typeof copyCanvasSelection> } | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const canvasActiveRef = useRef(false);
  useEffect(() => {
    const trackFocus = (event: PointerEvent) => {
      canvasActiveRef.current = event.target instanceof Element && Boolean(
        event.target.closest(".react-flow") && surfaceRef.current?.contains(event.target));
    };
    window.addEventListener("pointerdown", trackFocus, true);
    return () => window.removeEventListener("pointerdown", trackFocus, true);
  }, []);

  useEffect(() => {
    const handleUndo = (event: KeyboardEvent) => {
      const target = event.target;
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "z"
        || !(target instanceof Element) || target.closest("input, textarea, select, [contenteditable], [role=dialog]")
        || shortcutsOpen || viewer || orderedPreviewGroupId
        || !(surfaceRef.current?.contains(target) || target === document.body && canvasActiveRef.current)) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [orderedPreviewGroupId, shortcutsOpen, undo, viewer]);

  useEffect(() => {
    function handlesClipboard(event: ClipboardEvent) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return false;
      return !shortcutsOpen && !viewer && !orderedPreviewGroupId
        && (Boolean(surfaceRef.current?.contains(target)) || (target === document.body && canvasActiveRef.current));
    }
    const writeSelection = (event: ClipboardEvent, cut: boolean) => {
      if (!handlesClipboard(event) || !event.clipboardData || window.getSelection()?.toString()) return;
      const fragment = copyCanvasSelection(nodes, edges);
      const invalidOrdered = fragment.nodes.filter(isOrderedGroup).some((group) =>
        orderedMembersError(fragment.nodes.filter((node) => node.parentId === group.id), staticReviews.current));
      if (invalidOrdered) { setConnectionNotice("请先检查有序组内的静态图片。"); event.preventDefault(); return; }
      if (!fragment.nodes.length) {
        if (nodes.some((node) => node.selected)) { setConnectionNotice("所选节点暂不支持复制或剪切。"); event.preventDefault(); }
        return;
      }
      const selected = nodes.filter((node) => node.selected);
      const copiedIds = new Set(fragment.nodes.map((node) => node.id));
      if (cut && selected.some((node) => !copiedIds.has(node.id))) {
        setConnectionNotice("所选内容包含暂不支持剪切的节点。");
        event.preventDefault();
        return;
      }
      const token = crypto.randomUUID();
      clipboardRef.current = { token, fragment };
      event.clipboardData.setData(canvasClipboardType, token);
      const only = fragment.nodes.length === 1 ? fragment.nodes[0] : undefined;
      if (isModuleNode(only) && only.data.moduleType === "text") {
        event.clipboardData.setData("text/plain", only.data.textContent ?? "");
      }
      event.preventDefault();
      if (cut) {
        commitPendingHistory();
        setNodes((current) => current.filter((node) => !copiedIds.has(node.id)));
        setEdges((current) => current.filter((edge) => !copiedIds.has(edge.source) && !copiedIds.has(edge.target)));
        setConnectionNotice("");
      }
    };
    const copy = (event: ClipboardEvent) => writeSelection(event, false);
    const cut = (event: ClipboardEvent) => writeSelection(event, true);
    const paste = (event: ClipboardEvent) => {
      const flow = flowRef.current;
      const bounds = surfaceRef.current?.getBoundingClientRect();
      if (!handlesClipboard(event) || !event.clipboardData || !flow || !bounds) return;
      const position = flow.screenToFlowPosition(pointerRef.current ?? {
        x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2,
      });
      const insert = (fragment: ReturnType<typeof copyCanvasSelection>) => {
        commitPendingHistory();
        setNodes((current) => [...current.map((node) => node.selected ? { ...node, selected: false } : node), ...fragment.nodes]);
        setEdges((current) => [...current.map((edge) => edge.selected ? { ...edge, selected: false } : edge), ...fragment.edges]);
        setConnectionNotice("");
      };
      const copied = clipboardRef.current;
      if (copied && event.clipboardData.getData(canvasClipboardType) === copied.token) {
        event.preventDefault();
        insert(pasteCanvasSelection(copied.fragment, position));
        return;
      }
      const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
      if (images.length) {
        event.preventDefault();
        void uploadImages(images).then((assets) => {
          const pasted = assets.map((asset, index) => {
            const node = materialNode("image", { x: position.x + index % 4 * 280, y: position.y + Math.floor(index / 4) * 244 });
            const scale = asset.width && asset.height ? Math.min(1, 320 / Math.max(asset.width, asset.height)) : 1;
            return {
              ...node,
              style: asset.width && asset.height ? {
                width: Math.max(80, Math.round(asset.width * scale)), height: Math.max(80, Math.round(asset.height * scale)),
              } : node.style,
              data: { ...node.data, assetId: asset.id, previewUrl: asset.previewUrl ?? undefined, title: asset.name, naturalSizeApplied: true },
            };
          });
          insert({ nodes: pasted, edges: [] });
          onAssetImported();
        }).catch((error: unknown) => setConnectionNotice(error instanceof Error ? error.message : "无法粘贴图片"));
        return;
      }
      const plainText = event.clipboardData.getData("text/plain");
      if (!plainText) return;
      event.preventDefault();
      const node = materialNode("text", position);
      node.data.textContent = plainText;
      insert({ nodes: [node], edges: [] });
    };
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", paste);
    };
  }, [commitPendingHistory, edges, nodes, onAssetImported, orderedPreviewGroupId, setEdges, setNodes, shortcutsOpen, uploadImages, viewer]);

  const focusSequence = useCallback((sequence: AssetSequence) => {
    const instance = flowRef.current;
    if (!instance) return;
    const groups = nodes.filter((node) => node.type === "group" && node.data.sequenceId === sequence.id);
    const frameIds = new Set(sequence.frames.map((frame) => frame.id));
    const matches = groups.length ? groups : nodes.filter((node) => isModuleNode(node) && node.data.assetId && frameIds.has(node.data.assetId));
    const ids = new Set(matches.map((node) => hiddenBy.get(node.id) ?? node.id));
    if (!ids.size) return;
    setNodes((current) => current.map((node) => ({ ...node, selected: ids.has(node.id) })));
    void instance.fitView({ nodes: [...ids].map((id) => ({ id })), duration: 350, padding: .35, maxZoom: 1.2 });
  }, [hiddenBy, nodes, setNodes]);

  useImperativeHandle(ref, () => ({ addNode, focusAsset, focusSequence, placeAsset, redo, undo }), [addNode, focusAsset, focusSequence, placeAsset, redo, undo]);

  const onDrop = useCallback((event: React.DragEvent) => {
    const sequence = event.dataTransfer.getData(SEQUENCE_DRAG_TYPE);
    const serialized = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    const externalFiles = !serialized && !sequence && event.dataTransfer.types.includes("Files");
    if ((!serialized && !sequence && !externalFiles) || !flowRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (externalFiles) {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) { setConnectionNotice("请打开文件夹，选中图片文件后拖入画布。"); return; }
      if (files.some(isLocalVideo)) {
        if (!files.every(isLocalVideo)) { setConnectionNotice("请将视频与图片分开拖入"); return; }
        if (files.length > 20) { setConnectionNotice("单次最多拖入 20 个视频"); return; }
        const position = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const group = groupAtPoint(nodesRef.current, position);
        void (async () => {
          for (const [index, file] of files.entries()) {
            const node = materialNode("video", group ? { x: position.x - group.position.x + index * 40, y: position.y - group.position.y + index * 40 }
              : { x: position.x + index * 40, y: position.y + index * 40 });
            node.parentId = group?.id;
            if (!await importVideo(node.id, file, node)) break;
          }
        })();
        return;
      }
      if (files.length > 500) { setConnectionNotice("单次最多导入 500 张图片。"); return; }
      const supported = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/apng"]);
      const extensionTypes: Record<string, string> = { png: "image/png", apng: "image/png", jpg: "image/jpeg",
        jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
      const images: File[] = [];
      for (const file of files) {
        const type = file.type || extensionTypes[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
        if (!supported.has(type)) { setConnectionNotice(`不支持 ${file.name}，请拖入 PNG、JPEG、WebP 或 GIF 图片。`); return; }
        if (file.size > 50 * 1024 * 1024) { setConnectionNotice(`${file.name} 超过 50MB，请选择更小的图片。`); return; }
        images.push(file.type && type !== "image/apng" ? file : new File([file], file.name, {
          type: type === "image/apng" ? "image/png" : type, lastModified: file.lastModified,
        }));
      }
      const position = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const group = groupAtPoint(nodesRef.current, position);
      const node = materialNode("image", group ? {
        x: position.x - group.position.x, y: position.y - group.position.y,
      } : position);
      node.parentId = group?.id;
      void importImage(node.id, images, node);
      return;
    }
    try {
      const position = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (sequence) {
        const value = JSON.parse(sequence) as Parameters<typeof placeSequence>[0];
        if (typeof value.id === "string" && typeof value.name === "string" && Array.isArray(value.frames)
          && value.frames.length <= 1000 && value.frames.every((frame) => typeof frame?.id === "string" && typeof frame.name === "string"
            && (frame.durationMs === undefined || (typeof frame.durationMs === "number" && Number.isFinite(frame.durationMs))))) placeSequence(value, position);
      } else insertAsset(JSON.parse(serialized) as AssetSummary, position, true);
    } catch {
      // Ignore malformed external drag data.
    }
  }, [importImage, importVideo, insertAsset, placeSequence]);

  const onNodeDrag: OnNodeDrag<CanvasNode> = useCallback((_event, node, draggedNodes) => {
    if (node.type === "group" && node.data.frameSourceId) return;
    const current = flowRef.current?.getNodes();
    if (!current || draggedNodes.length > 1) return;
    const originalParent = current.find((group) => group.id === node.parentId);
    const targetId = isOrderedGroup(originalParent) ? originalParent.id : groupDropTarget(current, node);
    setDropGroup(targetId);
    const group = current.find((candidate) => candidate.id === targetId);
    if (!isOrderedGroup(group)) { setOrderHint(null); return; }
    const byId = new Map(current.map((item) => [item.id, item]));
    const point = worldPosition(node, byId), origin = worldPosition(group, byId);
    const hint = orderedInsertion(current, group.id, { ...node, position: { x: point.x - origin.x, y: point.y - origin.y } });
    setOrderHint(hint ? { groupId: group.id, position: hint.position } : null);
  }, []);

  const onNodeDragStop: OnNodeDrag<CanvasNode> = useCallback((_event, node, draggedNodes) => {
    setDropGroup(undefined);
    setOrderHint(null);
    if (node.type === "group" && node.data.frameSourceId && node.parentId) {
      const parentId = node.parentId;
      setNodes((previous) => fitFrameBatch(previous, parentId));
      return;
    }
    const current = flowRef.current?.getNodes();
    if (!current) return;
    if (draggedNodes.length > 1) {
      setNodes((previous) => {
        let next = previous;
        for (const group of previous.filter(isOrderedGroup)) next = layoutOrderedForMode(next, group.id);
        return next;
      });
      return;
    }
    const parent = current.find((group) => group.id === node.parentId);
    const target = isOrderedGroup(parent) ? parent.id : groupDropTarget(current, node);
    const group = current.find((candidate) => candidate.id === target);
    if (isOrderedGroup(group)) {
      void reviewStaticMembers([node]).then(() => {
        setNodes((previous) => {
          const activeGroup = previous.find((item) => item.id === group.id);
          const latest = previous.find((item) => item.id === node.id);
          if (!isOrderedGroup(activeGroup) || !isModuleNode(latest) || latest.parentId !== node.parentId
            || !latest.data.assetId || staticReviews.current.get(latest.data.assetId)?.status !== "static") return previous;
          const byId = new Map(previous.map((item) => [item.id, item]));
          const point = worldPosition(node, byId), origin = worldPosition(activeGroup, byId);
          const moved = { ...latest, parentId: group.id, extent: undefined, position: { x: point.x - origin.x, y: point.y - origin.y } };
          const insertion = orderedInsertion(previous, group.id, moved);
          if (!insertion) return previous;
          const next = previous.map((item) => item.id === node.id ? moved
            : item.id === group.id && item.type === "group" ? { ...item, data: { ...item.data, orderedChildIds: insertion.order } } : item);
          return layoutOrderedForMode(next, group.id);
        });
      }).catch((error: unknown) => {
        setConnectionNotice(error instanceof Error ? error.message : "无法加入有序组");
        if (isOrderedGroup(parent)) setNodes((previous) => layoutOrderedForMode(previous, parent.id));
      });
      return;
    }
    if (target || node.parentId) setNodes((previous) => applyGroupDrop(previous, node, target));
  }, [reviewStaticMembers, setNodes]);

  const handleNodeChanges = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const removed = new Set(changes.flatMap((change) => change.type === "remove" ? [change.id] : []));
    const extra: NodeChange<CanvasNode>[] = [];
    if (removed.size) {
      for (const node of parentsFirst(nodes)) {
        if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
          removed.add(node.id);
          extra.push({ type: "remove", id: node.id });
        }
      }
    }
    const accepted = changes.flatMap((change): NodeChange<CanvasNode>[] => {
      if (change.type === "position" && batchLayout.positions.has(change.id)) return [];
      if (change.type === "dimensions" && (batchLayout.sizes.has(change.id) || nodes.some((node) =>
        node.id === change.id && node.type === "group" && node.data.collapsed))) {
        // Keep React Flow's hit-test measurement without persisting the temporary size.
        return [{ ...change, setAttributes: false }];
      }
      return [change];
    });
    onNodesChange([...accepted, ...extra]);
    if (removed.size) setNodes((current) => current.map((node) => node.type === "group" && node.data.orderedChildIds
      ? { ...node, data: { ...node.data, orderedChildIds: node.data.orderedChildIds.filter((id) => !removed.has(id)),
        frameDurationsMs: Object.fromEntries(Object.entries(node.data.frameDurationsMs ?? {}).filter(([id]) => !removed.has(id))) } } : node));
  }, [batchLayout, nodes, onNodesChange, setNodes]);

  const captureBoxHits = () => {
    if (!boxSelecting.current) return;
    const surface = surfaceRef.current;
    const selection = surface?.querySelector(".react-flow__selection");
    if (!surface || !selection) return;
    const box = selection.getBoundingClientRect();
    const selectable = new Set(interactiveNodes.filter((node) => !node.hidden && node.selectable !== false).map((node) => node.id));
    const hits = new Set<string>();
    for (const element of surface.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) {
      const id = element.dataset.id;
      if (!id || !selectable.has(id)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.left < box.right && rect.right > box.left
        && rect.top < box.bottom && rect.bottom > box.top) hits.add(id);
    }
    boxHits.current = hits;
  };

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
    <div className={styles.surface} ref={surfaceRef} onPointerMove={(event) => { pointerRef.current = { x: event.clientX, y: event.clientY }; }}
      onPointerLeave={() => { pointerRef.current = null; }} onPointerUpCapture={captureBoxHits} onPointerCancelCapture={() => {
      boxSelecting.current = false;
      boxHits.current = null;
    }}>
      {videoImportDialog}
      <CanvasNodeActionsProvider value={nodeActions}>
        <ReactFlow<CanvasNode, Edge>
          className={styles.flow}
          nodes={interactiveNodes}
          edges={interactiveEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodeChanges}
          onSelectionStart={() => { boxSelecting.current = true; boxHits.current = null; }}
          onSelectionEnd={() => {
            boxSelecting.current = false;
            const hits = boxHits.current;
            boxHits.current = null;
            if (!hits) return;
            setNodes((current) => current.map((node) => Boolean(node.selected) === hits.has(node.id)
              ? node : { ...node, selected: hits.has(node.id) }));
            const connected = new Set(interactiveEdges.filter((edge) => !edge.hidden && edge.selectable !== false
              && (hits.has(edge.source) || hits.has(edge.target))).map((edge) => edge.id));
            setEdges((current) => current.map((edge) => Boolean(edge.selected) === connected.has(edge.id)
              ? edge : { ...edge, selected: connected.has(edge.id) }));
          }}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={() => { setConnectionMenu(null); setConnectionNotice(""); }}
          onConnectEnd={onConnectEnd}
          onNodeClick={(event, clicked) => {
            if (clicked.selectable === false || (event.target instanceof Element
              && event.target.closest("button, a, input, textarea, select, [contenteditable], .react-flow__handle, .react-flow__resize-control"))) return;
            // Use the selection from before React Flow applies its own click changes.
            const selectedIds = new Set(event.ctrlKey ? nodes.filter((node) => node.selected).map((node) => node.id) : []);
            if (event.ctrlKey && selectedIds.has(clicked.id)) selectedIds.delete(clicked.id);
            else selectedIds.add(clicked.id);
            setNodes((current) => current.map((node) => Boolean(node.selected) === selectedIds.has(node.id)
              ? node : { ...node, selected: selectedIds.has(node.id) }));
            if (!event.ctrlKey) setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
          }}
          onNodeMouseEnter={(_event, node) => setHoveredNode(node.id)}
          onNodeMouseLeave={() => setHoveredNode(null)}
          onPaneClick={() => setConnectionNotice("")}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ strokeDasharray: "5 5", strokeWidth: 2 }}
          connectionRadius={22}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onMove={(_event, nextViewport) => setLiveZoom(nextViewport.zoom)}
          onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
          onInit={(instance) => { flowRef.current = instance; }}
          isValidConnection={isValidConnection}
          deleteKeyCode={["Backspace", "Delete"]}
          defaultViewport={viewport}
          elementsSelectable
          multiSelectionKeyCode={null}
          fitView={!initialDocument}
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          maxZoom={2}
          minZoom={0.05}
          nodesConnectable
          nodesDraggable
          panOnDrag={interactionMode === "pan" ? [0, 1, 2] : [1, 2]}
          selectionOnDrag={interactionMode === "select"}
          selectionMode={SelectionMode.Partial}
        >
          {orderHint ? <ViewportPortal><div className={styles.orderedInsertion} style={(() => {
            const group = nodes.find((node) => node.id === orderHint.groupId);
            const origin = group ? worldPosition(group, new Map(nodes.map((node) => [node.id, node]))) : { x: 0, y: 0 };
            return { left: origin.x + orderHint.position.x - 10, top: origin.y + orderHint.position.y, height: 146 };
          })()} /></ViewportPortal> : null}
          {connectionMenu ? <ViewportPortal>
            <svg aria-hidden="true" className={styles.pendingConnection}><path d={connectionMenu.path} /></svg>
          </ViewportPortal> : null}
          {canCombine || canGroup ? (
            <NodeToolbar className={styles.imageToolbar} isVisible nodeId={(canCombine ? selectedGroups : selectedNodes).map((node) => node.id)} offset={16} position={Position.Top}>
              {canCombine ? <>
                <button className={styles.groupSelectionButton} onClick={() => applyGroupCombination("merge")} type="button"><Icon name="layers" />合并组</button>
                <button className={styles.groupSelectionButton} onClick={() => applyGroupCombination("nest")} type="button"><Icon name="group" />组中组</button>
              </> : <>
                <button className={`${styles.groupSelectionButton} nodrag nopan`} onClick={nodeActions.groupSelection} type="button"><Icon name="group" />打组</button>
                {canOrderedGroup && <button className={`${styles.groupSelectionButton} nodrag nopan`} onClick={nodeActions.createOrderedGroup} type="button"><Icon name="layers" />组成有序组</button>}
              </>}
            </NodeToolbar>
          ) : null}
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
              <input aria-label="调整画布缩放" max="2" min="0.05" onChange={(event) => changeZoom(Number(event.target.value))} step="0.01" type="range" value={liveZoom} />
              <output>{Math.round(liveZoom * 100)}%</output>
            </label>
            <button aria-label="查看画布快捷键" onClick={() => setShortcutsOpen(true)} title="查看画布快捷键" type="button"><Icon name="help" /></button>
          </div>
        </ReactFlow>
      </CanvasNodeActionsProvider>
      {connectionMenu ? <div className={styles.connectionMenuLayer} onPointerDown={(event) => {
        if (event.target === event.currentTarget) setConnectionMenu(null);
      }}>
        <section aria-label="创建并连接节点" className={styles.connectionMenu} style={{ left: connectionMenu.anchor.x, top: connectionMenu.anchor.y }}>
          <header><strong>{connectionMenu.fromInput ? "连接上游节点" : "连接下游节点"}</strong>
            <button aria-label="关闭节点选项" onClick={() => setConnectionMenu(null)} type="button">×</button></header>
          {connectionMenu.options.map((option, index) => {
            const definition = canvasModules[option.type];
            return <button autoFocus={index === 0} key={`${option.type}:${option.handleId}`} onClick={() => createConnectedNode(option)} type="button">
              <Icon name={definition.icon} />{definition.label}
            </button>;
          })}
        </section>
      </div> : null}
      {connectionNotice ? <p className={styles.connectionNotice} role="status">{connectionNotice}</p> : null}
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
        const tasks = readFrameTasks(viewer.nodeId);
        const seen = new Set<string>();
        const sources = tasks.flatMap((task) => task.sources.filter((source) => {
          if (seen.has(source.id)) return false;
          seen.add(source.id);
          return true;
        }));
        const task = tasks[0] ? { ...tasks[0], sources } : undefined;
        return task ? <FrameSequenceViewer initialSourceId={viewer.sourceId} onClose={() => setViewer(null)} onPlace={(sourceId) => { if (!sources.find((source) => source.id === sourceId)?.manualGroupId) void materializeFrameSequence(viewer.nodeId, sourceId); setViewer(null); }} task={task} /> : null;
      })() : null}
      {orderedPreviewGroupId ? (() => {
        const task = readOrderedGroup(orderedPreviewGroupId);
        return task ? <FrameSequenceViewer initialSourceId={orderedPreviewGroupId} onClose={() => setOrderedPreviewGroupId(null)} onCropEdit={() => void openOrderedCrop(orderedPreviewGroupId)} task={task} /> : null;
      })() : null}
      {cropSource && <CropSetup source={cropSource} onClose={() => setCropSource(null)} onCreate={createCropPreview} />}
    </div>
  );
});
