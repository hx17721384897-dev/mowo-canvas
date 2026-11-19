import type { Edge } from "@xyflow/react";
import { parentsFirst, worldPosition } from "./group-layout.ts";
import type { CanvasNode } from "./types";

export const canvasClipboardType = "application/x-mowo-canvas-nodes";

type CanvasFragment = { nodes: CanvasNode[]; edges: Edge[] };

function canCopy(node: CanvasNode) {
  if (node.selectable === false) return false;
  if (node.type === "group") return !node.data.frameTask && !node.data.frameSourceId;
  return !node.data.busy && !node.data.frameTask && !node.data.savedSequences
    && !["crop-result", "frame-extraction", "video-frame-extraction", "frame-batch", "frame-result", "frame-stitch"].includes(node.data.moduleType);
}

export function copyCanvasSelection(nodes: CanvasNode[], edges: Edge[]): CanvasFragment {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  function subtree(node: CanvasNode): CanvasNode[] {
    if (!canCopy(node)) return [];
    const branch = [node];
    for (const child of children.get(node.id) ?? []) {
      const descendants = subtree(child);
      if (!descendants.length) return [];
      for (const descendant of descendants) branch.push(descendant);
    }
    return branch;
  }

  const selected = new Map<string, CanvasNode>();
  for (const node of nodes) {
    if (node.selected) for (const member of subtree(node)) selected.set(member.id, member);
  }

  return structuredClone({
    nodes: parentsFirst([...selected.values()].map((node) => {
      if (node.parentId && selected.has(node.parentId)) return node;
      return { ...node, parentId: undefined, extent: undefined, position: worldPosition(node, byId) };
    })),
    edges: edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
  });
}

export function pasteCanvasSelection(fragment: CanvasFragment, position: { x: number; y: number }): CanvasFragment {
  const ids = new Map(fragment.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const roots = fragment.nodes.filter((node) => !node.parentId);
  const x = Math.min(...roots.map((node) => node.position.x));
  const y = Math.min(...roots.map((node) => node.position.y));
  return {
    nodes: fragment.nodes.map((node) => {
      const id = ids.get(node.id)!;
      const parentId = node.parentId ? ids.get(node.parentId) : undefined;
      const placed = {
        ...node, id, parentId, selected: !parentId, measured: undefined, dragging: undefined, resizing: undefined,
        position: parentId ? { ...node.position } : { x: position.x + node.position.x - x, y: position.y + node.position.y - y },
      };
      if (node.type !== "group") return { ...placed, type: "module", data: { ...node.data, statusMessage: undefined } };
      return { ...placed, type: "group", data: {
        ...node.data,
        orderedChildIds: node.data.orderedChildIds?.flatMap((childId) => ids.has(childId) ? [ids.get(childId)!] : []),
        frameDurationsMs: node.data.frameDurationsMs && Object.fromEntries(
          Object.entries(node.data.frameDurationsMs).flatMap(([childId, duration]) => ids.has(childId) ? [[ids.get(childId)!, duration]] : [])),
      } };
    }),
    edges: fragment.edges.map((edge) => ({
      ...edge, id: crypto.randomUUID(), source: ids.get(edge.source)!, target: ids.get(edge.target)!, selected: false,
    })),
  };
}
