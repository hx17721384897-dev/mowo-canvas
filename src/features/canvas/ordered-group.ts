import type { CanvasGroupNode, CanvasNode } from "./types";

export const orderedCell = { width: 180, height: 146, gap: 20, left: 24, top: 42 };

export function isOrderedGroup(node: CanvasNode | undefined): node is CanvasGroupNode & { data: CanvasGroupNode["data"] & { orderedChildIds: string[] } } {
  return node?.type === "group" && node.data.orderedChildIds !== undefined && !node.data.frameTask && !node.data.frameSourceId;
}

export function initialFrameOrder(members: CanvasNode[]) {
  return [...members].sort((a, b) => Math.floor(a.position.y / 48) - Math.floor(b.position.y / 48)
    || a.position.x - b.position.x || a.position.y - b.position.y).map((node) => node.id);
}

export function orderedMembersError(members: CanvasNode[], statuses: ReadonlyMap<string, { status: string; reason?: string }>) {
  if (!members.length) return "有序组至少需要一张静态图片。";
  for (const node of members) {
    if (node.type !== "module" || node.data.moduleType !== "image" || !node.data.assetId || !node.data.previewUrl || node.data.busy) {
      return "有序组只接受已导入的静态图片，请先移出其他节点、空图片或子组。";
    }
    const checked = statuses.get(node.data.assetId);
    if (checked?.status !== "static") {
      return `${node.data.title ?? "图片"}：${checked?.status === "unavailable" ? "素材缺失或无法读取，请重新导入" : checked ? "请先拆帧，再加入有序组" : "尚未完成静态图片检查"}。`;
    }
  }
}

export function layoutOrderedGroup(nodes: CanvasNode[], groupId: string, requestedWidth?: number, compact = false) {
  const group = nodes.find((node) => node.id === groupId);
  if (!isOrderedGroup(group) || group.data.collapsed || group.data.resizeMode === "scale") return nodes;
  const ids = new Set(group.data.orderedChildIds);
  const members = new Map(nodes.filter((node) => node.parentId === groupId).map((node) => [node.id, node]));
  const order = group.data.orderedChildIds!.filter((id) => members.has(id));
  for (const id of members.keys()) if (!ids.has(id)) order.push(id);
  const cell = orderedCell;
  const width = Math.max(260, requestedWidth ?? Number(group.style?.width ?? group.width ?? 600));
  const columns = Math.max(1, Math.floor((width - cell.left * 2 + cell.gap) / (cell.width + cell.gap)));
  const height = Math.max(180, cell.top + Math.ceil(order.length / columns) * (cell.height + cell.gap) - cell.gap + cell.left);
  const actualWidth = compact ? Math.max(260, Math.min(columns, Math.max(1, order.length)) * (cell.width + cell.gap) - cell.gap + cell.left * 2) : width;
  const positions = new Map(order.map((id, index) => [id, {
    x: cell.left + index % columns * (cell.width + cell.gap),
    y: cell.top + Math.floor(index / columns) * (cell.height + cell.gap),
  }]));
  let changed = false;
  const next = nodes.map((node): CanvasNode => {
    if (node.id === groupId && node.type === "group") {
      if (Number(node.style?.width) === actualWidth && Number(node.style?.height) === height
        && JSON.stringify(node.data.orderedChildIds) === JSON.stringify(order) && node.data.resizeMode !== "scale") return node;
      changed = true;
      return { ...node, width: undefined, height: undefined, measured: undefined,
        style: { ...node.style, width: actualWidth, height },
        data: { ...node.data, orderedChildIds: order, resizeMode: "reflow", scaleBase: undefined } };
    }
    const position = positions.get(node.id);
    if (!position || node.type !== "module") return node;
    if (node.position.x === position.x && node.position.y === position.y && Number(node.style?.width) === cell.width
      && Number(node.style?.height) === cell.height && node.data.naturalSizeApplied && node.extent === undefined) return node;
    changed = true;
    return { ...node, position, width: undefined, height: undefined, measured: undefined, extent: undefined,
      style: { ...node.style, width: cell.width, height: cell.height }, data: { ...node.data, naturalSizeApplied: true } };
  });
  return changed ? next : nodes;
}

export function orderedInsertion(nodes: CanvasNode[], groupId: string, dragged: CanvasNode) {
  const group = nodes.find((node) => node.id === groupId);
  if (!isOrderedGroup(group)) return;
  const order = group.data.orderedChildIds!.filter((id) => id !== dragged.id);
  const members = new Map(nodes.filter((node) => node.parentId === groupId).map((node) => [node.id, node]));
  const center = { x: dragged.position.x + Number(dragged.style?.width ?? dragged.width ?? 180) / 2,
    y: dragged.position.y + Number(dragged.style?.height ?? dragged.height ?? 146) / 2 };
  let index = order.findIndex((id) => {
    const member = members.get(id);
    if (!member) return false;
    const width = Number(member.style?.width ?? member.width ?? orderedCell.width);
    const height = Number(member.style?.height ?? member.height ?? orderedCell.height);
    return center.y < member.position.y || (center.y <= member.position.y + height
      && center.x < member.position.x + width / 2);
  });
  if (index < 0) index = order.length;
  const anchor = members.get(order[index]);
  const last = members.get(order.at(-1) ?? "");
  const position = anchor?.position ?? (last ? { x: last.position.x + Number(last.style?.width ?? last.width ?? orderedCell.width) + orderedCell.gap, y: last.position.y }
    : { x: orderedCell.left, y: orderedCell.top });
  order.splice(index, 0, dragged.id);
  return { order, position };
}
