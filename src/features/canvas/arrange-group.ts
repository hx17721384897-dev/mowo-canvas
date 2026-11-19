import type { CanvasNode } from "./types";
import { collapsedGroupSize } from "./group-layout.ts";

export function arrangeGroupChildren(children: CanvasNode[], animated: ReadonlyMap<string, boolean>, preferredWidth: number, keepPositionsOrder = false) {
  const sections: CanvasNode[][] = Array.from({ length: 6 }, () => []);
  const row = (node: CanvasNode) => Math.floor(node.position.y / 48);
  const ordered = keepPositionsOrder ? children : [...children].sort((a, b) => row(a) - row(b) || a.position.x - b.position.x || a.position.y - b.position.y);
  for (const node of ordered) {
    if (node.type === "group") sections[node.data.collapsed ? 4 : 5].push(node);
    else if (node.data.moduleType === "image" && node.data.previewUrl && node.data.assetId && animated.has(node.data.assetId)) {
      sections[animated.get(node.data.assetId) ? 1 : 0].push(node);
    } else if (node.data.moduleType === "video") sections[2].push(node);
    else sections[3].push(node);
  }
  const padding = 24;
  const gap = 22;
  let y = 42;
  let right = 0;
  const result: CanvasNode[] = [];
  for (const [index, section] of sections.entries()) {
    if (!section.length) continue;
    let x = padding;
    let rowHeight = 0;
    for (const node of section) {
      const uniform = index < 3;
      const width = uniform ? 180 : index === 4 ? collapsedGroupSize.width : Number(node.style?.width ?? node.width ?? node.measured?.width ?? 260);
      const height = uniform ? 146 : index === 4 ? collapsedGroupSize.height : Number(node.style?.height ?? node.height ?? node.measured?.height ?? 180);
      if (x > padding && (index === 5 || x + width + padding > preferredWidth)) {
        y += rowHeight + gap;
        x = padding;
        rowHeight = 0;
      }
      const placed = { ...node, position: { x, y } };
      if (uniform && placed.type === "module") {
        placed.width = undefined;
        placed.height = undefined;
        placed.style = { ...placed.style, width, height };
        placed.data = { ...placed.data, naturalSizeApplied: true };
      }
      result.push(placed);
      right = Math.max(right, x + width);
      rowHeight = Math.max(rowHeight, height);
      x += width + gap;
    }
    y += rowHeight + 38;
  }
  return { nodes: result, width: Math.max(260, right + padding), height: Math.max(180, y - 14) };
}

export function projectExpandedBatches(nodes: CanvasNode[]) {
  const batches = new Set(nodes.filter((node) => node.type === "group" && node.data.frameTask && !node.data.collapsed).map((node) => node.id));
  const children = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    if (node.parentId && batches.has(node.parentId) && node.type === "group" && node.data.frameSourceId) {
      const members = children.get(node.parentId) ?? [];
      members.push(node);
      children.set(node.parentId, members);
    }
  }
  const positions = new Map<string, CanvasNode["position"]>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const [id, members] of children) {
    if (members.every((member) => member.type === "group" && member.data.collapsed)) continue;
    const layout = arrangeGroupChildren(members, new Map(), 660, true);
    sizes.set(id, { width: layout.width, height: layout.height });
    for (const member of layout.nodes) positions.set(member.id, member.position);
  }
  return { positions, sizes };
}
