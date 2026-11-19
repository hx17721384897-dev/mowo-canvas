import type { Edge } from "@xyflow/react";
import { isOrderedGroup, layoutOrderedGroup } from "./ordered-group.ts";
import type { CanvasGroupNode, CanvasNode } from "./types";

export const collapsedGroupSize = { width: 184, height: 146 };

export function setGroupResizeMode(nodes: CanvasNode[], groupId: string, mode: "reflow" | "scale") {
  const group = nodes.find((node) => node.id === groupId);
  if (group?.type !== "group" || group.data.frameTask || group.data.frameSourceId) return nodes;
  const children = nodes.filter((node) => node.parentId === groupId);
  const scaleBase = mode === "scale" ? Object.fromEntries(children.filter((node) => node.type === "module" && node.data.moduleType === "image")
    .map((node) => [node.id, group.data.resizeMode === "scale" ? group.data.scaleBase?.[node.id] ?? bounds(node) : bounds(node)])) : undefined;
  const updated = nodes.map((node) => node.id === groupId && node.type === "group"
    ? { ...node, data: { ...node.data, resizeMode: mode, scaleBase } }
    : mode === "reflow" && node.parentId === groupId && group.data.scaleBase?.[node.id]
      ? { ...node, width: undefined, height: undefined, measured: undefined,
        style: { ...node.style, ...group.data.scaleBase[node.id] } } : node);
  const imageOnly = children.length > 0 && children.every((node) => node.type === "module" && node.data.moduleType === "image");
  return group.data.collapsed || !imageOnly ? updated : containGroupMembers(updated, groupId, bounds(group));
}

export function setAllGroupResizeModes(nodes: CanvasNode[], mode: "reflow" | "scale") {
  return nodes.filter((node) => node.type === "group" && !node.data.frameTask && !node.data.frameSourceId)
    .reduce((current, group) => setGroupResizeMode(current, group.id, mode), nodes);
}

export function containGroupMembers(nodes: CanvasNode[], groupId: string, requested: { width: number; height: number }) {
  const group = nodes.find((node) => node.id === groupId);
  if (group?.type !== "group" || group.data.frameTask || group.data.frameSourceId) return nodes;
  const children = nodes.filter((node) => node.parentId === groupId);
  if (group.data.resizeMode === "scale" && children.length && children.every((node) => node.type === "module" && node.data.moduleType === "image")) {
    return scaleGroupImages(nodes, group, children, requested);
  }
  if (isOrderedGroup(group)) return layoutOrderedGroup(nodes, groupId, requested.width);
  const pad = 16;
  const top = 38;
  const width = Math.max(260, requested.width, ...children.map((child) => bounds(child).width + pad * 2));
  let height = Math.max(180, requested.height, ...children.map((child) => bounds(child).height + top + pad));
  const placed = children.map((child) => {
    const size = bounds(child);
    return { node: child, size, position: {
      x: Math.max(pad, Math.min(child.position.x, width - pad - size.width)),
      y: Math.max(top, Math.min(child.position.y, height - pad - size.height)),
    } };
  });
  const overlaps = placed.some((item, index) => placed.slice(index + 1).some((other) =>
    item.position.x < other.position.x + other.size.width && item.position.x + item.size.width > other.position.x
    && item.position.y < other.position.y + other.size.height && item.position.y + item.size.height > other.position.y));
  if (overlaps) {
    const ordered = group.data.orderedChildIds
      ? [...placed].sort((a, b) => group.data.orderedChildIds!.indexOf(a.node.id) - group.data.orderedChildIds!.indexOf(b.node.id))
      : [...placed].sort((a, b) => a.node.position.y - b.node.position.y || a.node.position.x - b.node.position.x);
    let x = pad, y = top, rowHeight = 0;
    for (const item of ordered) {
      if (x > pad && x + item.size.width + pad > width) { x = pad; y += rowHeight + 16; rowHeight = 0; }
      item.position = { x, y };
      x += item.size.width + 16;
      rowHeight = Math.max(rowHeight, item.size.height);
    }
    height = Math.max(height, y + rowHeight + pad);
  }
  const positions = new Map(placed.map((item) => [item.node.id, item.position]));
  return nodes.map((node) => node.id === groupId
    ? { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height } }
    : positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node);
}

function scaleGroupImages(nodes: CanvasNode[], group: CanvasGroupNode, children: CanvasNode[], requested: { width: number; height: number }) {
  const bases = children.map((child) => ({ node: child, size: group.data.scaleBase?.[child.id] ?? bounds(child) }));
  const minScale = Math.min(1, Math.max(...bases.map(({ size }) => Math.max(80 / Math.max(1, size.width), 80 / Math.max(1, size.height)))));
  const availableWidth = Math.max(260, requested.width);
  const availableHeight = Math.max(180, requested.height);
  const ordered = group.data.orderedChildIds
    ? [...bases].sort((a, b) => group.data.orderedChildIds!.indexOf(a.node.id) - group.data.orderedChildIds!.indexOf(b.node.id))
    : [...bases].sort((a, b) => a.node.position.y - b.node.position.y || a.node.position.x - b.node.position.x);
  const layouts = Array.from({ length: ordered.length }, (_, index) => {
    const columns = index + 1;
    const rows = Array.from({ length: Math.ceil(ordered.length / columns) }, (_, row) => ordered.slice(row * columns, (row + 1) * columns));
    const rowWidths = rows.map((row) => row.reduce((sum, item) => sum + item.size.width, 0) + 16 * (row.length - 1));
    const rowHeights = rows.map((row) => Math.max(...row.map((item) => item.size.height)));
    const contentWidth = Math.max(...rowWidths) + 32;
    const contentHeight = rowHeights.reduce((sum, height) => sum + height, 0) + 16 * (rows.length - 1) + 32;
    const scale = Math.max(minScale, Math.min(1, availableWidth / contentWidth, (availableHeight - 38) / contentHeight));
    const width = Math.max(availableWidth, Math.ceil(contentWidth * scale));
    const height = Math.max(availableHeight, Math.ceil(38 + contentHeight * scale));
    return { rows, scale, width, height, overflow: Math.max(0, width - availableWidth) * Math.max(1, height - availableHeight)
      + Math.max(0, height - availableHeight) * Math.max(1, width - availableWidth) };
  });
  layouts.sort((a, b) => a.overflow - b.overflow || b.scale - a.scale || a.rows.length - b.rows.length);
  const layout = layouts[0];
  const placed = new Map<string, CanvasNode>();
  let y = 38 + 16 * layout.scale;
  for (const row of layout.rows) {
    let x = 16 * layout.scale;
    let rowHeight = 0;
    for (const item of row) {
      const width = Math.round(item.size.width * layout.scale);
      const height = Math.round(item.size.height * layout.scale);
      placed.set(item.node.id, { ...item.node, position: { x: Math.round(x), y: Math.round(y) },
        width: undefined, height: undefined, measured: undefined, style: { ...item.node.style, width, height } });
      x += width + 16 * layout.scale;
      rowHeight = Math.max(rowHeight, height);
    }
    y += rowHeight + 16 * layout.scale;
  }
  return nodes.map((node) => node.id === group.id && node.type === "group"
    ? { ...node, width: layout.width, height: layout.height, measured: { width: layout.width, height: layout.height },
      style: { ...node.style, width: layout.width, height: layout.height },
      data: { ...node.data, scaleBase: { ...group.data.scaleBase,
        ...Object.fromEntries(bases.map(({ node, size }) => [node.id, size])) } } }
    : placed.get(node.id) ?? node);
}

function bounds(node: CanvasNode) {
  if (node.type === "group" && node.data.collapsed) return collapsedGroupSize;
  return {
    width: Number(node.width ?? node.measured?.width ?? node.style?.width ?? 0),
    height: Number(node.height ?? node.measured?.height ?? node.style?.height ?? 0),
  };
}

export function worldPosition(node: CanvasNode, byId: Map<string, CanvasNode>) {
  const point = { ...node.position };
  let parent = node.parentId;
  while (parent) {
    const item = byId.get(parent);
    if (!item) break;
    point.x += item.position.x;
    point.y += item.position.y;
    parent = item.parentId;
  }
  return point;
}

export function groupDropTarget(nodes: CanvasNode[], dragged: CanvasNode) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const point = worldPosition(dragged, byId);
  const size = bounds(dragged);
  let target: string | undefined;
  let bestDepth = -1;
  let bestOverlap = 0;
  for (const group of nodes) {
    if (group.type !== "group" || group.data.collapsed || group.data.frameTask || group.data.frameSourceId || group.hidden || group.id === dragged.id) continue;
    let depth = 0;
    let ancestor = group.parentId;
    while (ancestor && ancestor !== dragged.id) {
      depth++;
      ancestor = byId.get(ancestor)?.parentId;
    }
    if (ancestor === dragged.id) continue;
    const origin = worldPosition(group, byId);
    const box = bounds(group);
    const overlap = Math.max(0, Math.min(point.x + size.width, origin.x + box.width) - Math.max(point.x, origin.x))
      * Math.max(0, Math.min(point.y + size.height, origin.y + box.height) - Math.max(point.y, origin.y));
    const half = size.width * size.height / 2;
    if (!overlap || overlap < half || (overlap === half && group.id !== dragged.parentId)) continue;
    if (depth > bestDepth || (depth === bestDepth && overlap > bestOverlap)) {
      target = group.id;
      bestDepth = depth;
      bestOverlap = overlap;
    }
  }
  return target;
}

export function applyGroupDrop(nodes: CanvasNode[], dragged: CanvasNode, target?: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(dragged.id)) return nodes;
  const point = worldPosition(dragged, byId);
  const parent = target ? byId.get(target) : undefined;
  const origin = parent ? worldPosition(parent, byId) : { x: 0, y: 0 };
  let child: CanvasNode = { ...byId.get(dragged.id)!, parentId: parent?.id, extent: undefined,
    position: { x: point.x - origin.x, y: point.y - origin.y } };
  byId.set(child.id, child);
  while (child.parentId) {
    const group = byId.get(child.parentId);
    if (group?.type !== "group") break;
    const size = bounds(child);
    const box = bounds(group);
    const left = child.position.x < 0 ? child.position.x - 16 : 0;
    const top = child.position.y < 0 ? child.position.y - 16 : 0;
    const right = child.position.x + size.width;
    const bottom = child.position.y + size.height;
    const width = (right > box.width ? right + 16 : box.width) - left;
    const height = (bottom > box.height ? bottom + 16 : box.height) - top;
    if (width === box.width && height === box.height) break;
    child = { ...group, position: { x: group.position.x + left, y: group.position.y + top },
      width, height, style: { ...group.style, width, height } };
    byId.set(group.id, child);
    for (const member of byId.values()) {
      if (member.parentId === group.id) byId.set(member.id, {
        ...member, position: { x: member.position.x - left, y: member.position.y - top },
      });
    }
  }
  return parentsFirst([...byId.values()].map((node) => {
    if (node.type !== "group" || !node.data.orderedChildIds) return node;
    const members = [...byId.values()].filter((member) => member.parentId === node.id);
    const ids = new Set(members.map((member) => member.id));
    const order = node.data.orderedChildIds.filter((id) => ids.has(id));
    for (const member of members) if (!order.includes(member.id)) order.push(member.id);
    const frameDurationsMs = Object.fromEntries(Object.entries(node.data.frameDurationsMs ?? {}).filter(([id]) => ids.has(id)));
    return { ...node, data: { ...node.data, orderedChildIds: order, frameDurationsMs } };
  }));
}

export function parentsFirst(nodes: CanvasNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const sorted: CanvasNode[] = [];
  function visit(node: CanvasNode) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) visit(parent);
    sorted.push(node);
  }
  for (const node of nodes) visit(node);
  return sorted;
}

export function groupPresentation(nodes: CanvasNode[], edges: Edge[]) {
  const hiddenBy = new Map<string, string>();
  const byId = new Map<string, CanvasNode>();
  const covers = new Map<string, { count: number; preview?: string }>();
  for (const node of parentsFirst(nodes)) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      const cover = covers.get(parent.id) ?? { count: 0 };
      cover.count += 1;
      covers.set(parent.id, cover);
      const hidden = hiddenBy.get(parent.id) ?? (parent.type === "group" && parent.data.collapsed ? parent.id : undefined);
      if (hidden) {
        hiddenBy.set(node.id, hidden);
        const outerCover = covers.get(hidden);
        if (outerCover && !outerCover.preview && node.type === "module" && node.data.moduleType === "image") outerCover.preview = node.data.previewUrl;
      }
    }
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.type !== "group" || !node.data.collapsed || !node.data.orderedChildIds?.length) continue;
    const first = byId.get(node.data.orderedChildIds[0]);
    const cover = covers.get(node.id);
    if (cover && first?.type === "module" && first.data.moduleType === "image") cover.preview = first.data.previewUrl;
  }
  const visibleEdges = edges.map((edge) => {
    const source = hiddenBy.get(edge.source) ?? edge.source;
    const target = hiddenBy.get(edge.target) ?? edge.target;
    if (source === edge.source && target === edge.target) return edge;
    return {
      ...edge, source, target, hidden: source === target || edge.hidden,
      sourceHandle: source === edge.source ? edge.sourceHandle : "group-materials",
      targetHandle: target === edge.target ? edge.targetHandle : "collapsed-input",
    };
  });
  return { hiddenBy, covers, visibleEdges };
}

export function combineGroups(nodes: CanvasNode[], edges: Edge[], groups: CanvasGroupNode[], operation: "merge" | "nest", id: string) {
  const selected = new Set(groups.map((group) => group.id));
  const left = Math.min(...groups.map((group) => group.position.x)) - 24;
  const top = Math.min(...groups.map((group) => group.position.y)) - 36;
  const width = Math.max(...groups.map((group) => group.position.x + (operation === "nest" && group.data.collapsed
    ? collapsedGroupSize.width : Number(group.width ?? group.style?.width ?? 440)))) - left + 24;
  const height = Math.max(...groups.map((group) => group.position.y + (operation === "nest" && group.data.collapsed
    ? collapsedGroupSize.height : Number(group.height ?? group.style?.height ?? 300)))) - top + 24;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const wrapper: CanvasGroupNode = {
    id, type: "group", parentId: groups[0].parentId, position: { x: left, y: top }, style: { width, height },
    selected: true, data: { label: operation === "nest" ? "组中组" : groups[0].data.label },
  };
  const members = nodes.flatMap((node): CanvasNode[] => {
    if (operation === "merge" && selected.has(node.id)) return [];
    const origin = operation === "nest" ? byId.get(node.id) : node.parentId ? byId.get(node.parentId) : undefined;
    if (!origin) return [{ ...node, selected: false }];
    const position = operation === "nest" ? origin.position : { x: origin.position.x + node.position.x, y: origin.position.y + node.position.y };
    return [{ ...node, parentId: id, extent: undefined, selected: false, position: { x: position.x - left, y: position.y - top } }];
  });
  const seen = new Set<string>();
  const nextEdges = operation === "nest" ? edges : edges.flatMap((edge) => {
    const source = selected.has(edge.source) ? id : edge.source;
    const signature = JSON.stringify([source, edge.sourceHandle ?? (source === id ? "group-materials" : null), edge.target, edge.targetHandle ?? "animated-images"]);
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [{ ...edge, source }];
  });
  return { nodes: parentsFirst([wrapper, ...members]), edges: nextEdges };
}

export function dissolveGroups(nodes: CanvasNode[], removed: ReadonlySet<string>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return parentsFirst(nodes.filter((node) => !removed.has(node.id)).map((node) => {
    if (!node.parentId || !removed.has(node.parentId)) return node;
    let parentId: string | undefined = node.parentId;
    const position = { ...node.position };
    while (parentId && removed.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      position.x += parent.position.x;
      position.y += parent.position.y;
      parentId = parent.parentId;
    }
    return { ...node, parentId, extent: undefined, position, selected: true };
  }));
}
