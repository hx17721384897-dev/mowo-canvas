import type { CanvasNode } from "./types";

export type GroupExportEntry = { assetId: string; directories: string[]; order?: number };

export function groupExportManifest(nodes: CanvasNode[], groupId: string): { entries: GroupExportEntry[]; skipped: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const members = new Map<string, CanvasNode[]>();
  for (const node of nodes) if (node.parentId) members.set(node.parentId, [...(members.get(node.parentId) ?? []), node]);
  const entries: GroupExportEntry[] = [];
  let skipped = 0;
  const visit = (id: string, directories: string[], ancestors: Set<string>) => {
    if (ancestors.has(id)) return;
    const group = byId.get(id);
    if (group?.type !== "group") return;
    const nextAncestors = new Set(ancestors).add(id);
    const ordered = group.data.orderedChildIds;
    const children = [...(members.get(id) ?? [])].sort((a, b) => ordered
      ? (ordered.indexOf(a.id) < 0 ? Number.MAX_SAFE_INTEGER : ordered.indexOf(a.id)) - (ordered.indexOf(b.id) < 0 ? Number.MAX_SAFE_INTEGER : ordered.indexOf(b.id))
      : a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
    let frame = 0;
    let subgroup = 0;
    for (const child of children) {
      if (child.type === "group") {
        subgroup++;
        visit(child.id, [...directories, `${String(subgroup).padStart(2, "0")}_${child.data.label || "组"}`], nextAncestors);
      } else if (child.data.assetId && (child.data.moduleType === "image" || child.data.moduleType === "video")) {
        frame++;
        entries.push({ assetId: child.data.assetId, directories, ...(ordered ? { order: frame } : {}) });
      } else skipped++;
    }
  };
  visit(groupId, [], new Set());
  return { entries, skipped };
}
