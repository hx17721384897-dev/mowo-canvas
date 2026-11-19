import type { FrameExtractionTask } from "@/features/frame-extraction/types";
import { collapsedGroupSize, parentsFirst } from "./group-layout.ts";
import type { CanvasGroupNode, CanvasNode } from "./types";

export function frameBatchCompactSize(nodes: CanvasNode[], batchId: string) {
  const children = nodes.filter((node): node is CanvasGroupNode => node.parentId === batchId && node.type === "group");
  let width = 260;
  let height = 225;
  for (const child of children) {
    // Expanded sequence groups use a transient layout; the stored batch bounds follow their covers.
    width = Math.max(width, child.position.x + collapsedGroupSize.width + 24);
    height = Math.max(height, child.position.y + collapsedGroupSize.height + 24);
  }
  return { width, height };
}

export function fitFrameBatch(nodes: CanvasNode[], batchId: string) {
  const { width, height } = frameBatchCompactSize(nodes, batchId);
  return nodes.map((node) => {
    if (node.id !== batchId || node.type !== "group" || !node.data.frameTask) return node;
    return { ...node, width: undefined, height: undefined, style: { ...node.style, width, height } };
  });
}

export function syncFrameBatch(nodes: CanvasNode[], batch: CanvasGroupNode, task: FrameExtractionTask) {
  const oldSequences = new Map(nodes.filter((node): node is CanvasGroupNode =>
    node.type === "group" && node.parentId === batch.id && Boolean(node.data.frameSourceId))
    .map((node) => [node.data.frameSourceId, node]));
  const oldIds = new Set([...oldSequences.values()].map((node) => node.id));
  const children: CanvasNode[] = [];
  const sources = task.sources.filter((source) => source.status !== "failed");
  for (const [index, source] of sources.entries()) {
    const previous = oldSequences.get(source.id);
    const frames = source.frames.filter((frame) => frame.retained).sort((left, right) => left.position - right.position);
    const groupId = previous?.id ?? `${batch.id}-sequence-${source.id}`;
    const frameNodeIds = frames.map((frame) => `${groupId}-frame-${frame.id}`);
    const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(frames.length))));
    const group: CanvasGroupNode = {
      ...previous,
      id: groupId,
      type: "group",
      parentId: batch.id,
      extent: "parent",
      position: previous?.position ?? { x: 24 + (index % 3) * 210, y: 42 + Math.floor(index / 3) * 176 },
      style: { width: columns * 128 + 32, height: Math.ceil(frames.length / columns) * 120 + 56 },
      data: { orderedChildIds: frameNodeIds,
        frameDurationsMs: Object.fromEntries(frames.map((frame, index) => [frameNodeIds[index], frame.durationMs])),
        label: source.name, frameSourceId: source.id, collapsed: previous?.data.collapsed ?? true, frameSaved: source.status === "saved" },
      deletable: false,
    };
    children.push(group);
    for (const [index, frame] of frames.entries()) {
      children.push({
        id: frameNodeIds[index], type: "module", parentId: group.id,
        position: { x: 16 + (index % columns) * 128, y: 38 + Math.floor(index / columns) * 120 },
        style: { width: 110, height: 100 }, draggable: false, deletable: false, connectable: false, selectable: false,
        data: { moduleType: "image", previewUrl: frame.previewUrl, title: `第 ${index + 1} 帧`, naturalSizeApplied: true },
      });
    }
  }
  return parentsFirst(fitFrameBatch([
    ...nodes.filter((node) => node.id !== batch.id && !oldIds.has(node.id) && !oldIds.has(node.parentId ?? "")),
    { ...batch, data: { ...batch.data, frameTask: task } },
    ...children,
  ], batch.id));
}

export function restoreFrameBatches(nodes: CanvasNode[]) {
  let result = nodes;
  for (const node of nodes) {
    if (node.type !== "module" || node.data.moduleType !== "frame-batch" || !node.data.frameTask) continue;
    const batch: CanvasGroupNode = { id: node.id, type: "group", parentId: node.parentId, position: node.position, data: { label: "动画帧批次" } };
    result = syncFrameBatch(result, batch, node.data.frameTask);
  }
  for (const batch of result) {
    if (batch.type === "group" && batch.data.frameTask) result = fitFrameBatch(result, batch.id);
  }
  const byId = new Map(result.map((node) => [node.id, node]));
  return result.map((node) => {
    if (node.type !== "group" || !node.data.frameSourceId || node.data.orderedChildIds) return node;
    const batch = byId.get(node.parentId ?? "");
    const source = batch?.type === "group" && batch.data.frameTask?.sources.find((item) => item.id === node.data.frameSourceId);
    if (!source) return node;
    const frames = source.frames.filter((frame) => frame.retained).sort((a, b) => a.position - b.position);
    const entries = frames.flatMap((frame) => {
      const id = `${node.id}-frame-${frame.id}`;
      return byId.get(id)?.parentId === node.id ? [[id, frame.durationMs] as const] : [];
    });
    return { ...node, data: { ...node.data, orderedChildIds: entries.map(([id]) => id), frameDurationsMs: Object.fromEntries(entries) } };
  });
}
