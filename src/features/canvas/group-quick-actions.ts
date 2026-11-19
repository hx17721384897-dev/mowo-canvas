import type { IconName } from "@/app/components/app-icon";

export const groupActionIds = ["arrange", "preview", "toggle-collapse", "ungroup", "delete", "toggle-order", "toggle-scale", "export"] as const;

export type GroupActionId = (typeof groupActionIds)[number];
export type GroupActionZone = "toolbar" | "more";
export type GroupActionLayout = Record<GroupActionZone, GroupActionId[]>;

export const defaultGroupActionLayout: GroupActionLayout = {
  toolbar: ["arrange", "preview", "toggle-collapse", "ungroup", "delete", "export"],
  more: ["toggle-scale", "toggle-order"],
};

export function copyGroupActionLayout(layout: GroupActionLayout = defaultGroupActionLayout): GroupActionLayout {
  return { toolbar: [...layout.toolbar], more: layout.toolbar.includes("toggle-scale") || layout.more.includes("toggle-scale")
    ? [...layout.more] : ["toggle-scale", ...layout.more] };
}

export function moveGroupActionAt(layout: GroupActionLayout, action: GroupActionId, zone: GroupActionZone, index: number): GroupActionLayout {
  const currentZone = layout.toolbar.includes(action) ? "toolbar" : "more";
  const oldIndex = layout[currentZone].indexOf(action);
  if (oldIndex < 0) return layout;
  const next = { toolbar: layout.toolbar.filter((id) => id !== action), more: layout.more.filter((id) => id !== action) };
  const insertion = currentZone === zone && oldIndex < index ? index - 1 : index;
  next[zone].splice(Math.max(0, Math.min(insertion, next[zone].length)), 0, action);
  return next;
}

export function moveGroupAction(layout: GroupActionLayout, action: GroupActionId, zone: GroupActionZone, before?: GroupActionId): GroupActionLayout {
  const next = { toolbar: layout.toolbar.filter((id) => id !== action), more: layout.more.filter((id) => id !== action) };
  const target = next[zone];
  const index = before ? target.indexOf(before) : -1;
  target.splice(index < 0 ? target.length : index, 0, action);
  return next;
}

export function stepGroupAction(layout: GroupActionLayout, action: GroupActionId, direction: -1 | 1): GroupActionLayout {
  const zone = layout.toolbar.includes(action) ? "toolbar" : "more";
  const next = copyGroupActionLayout(layout);
  const index = next[zone].indexOf(action);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next[zone].length) return layout;
  [next[zone][index], next[zone][target]] = [next[zone][target], next[zone][index]];
  return next;
}

export function validGroupActionLayout(value: unknown): value is GroupActionLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const layout = value as Record<string, unknown>;
  if (!Array.isArray(layout.toolbar) || !Array.isArray(layout.more)) return false;
  const ids = [...layout.toolbar, ...layout.more];
  const required: GroupActionId[] = ["arrange", "preview", "toggle-collapse", "ungroup", "delete", "toggle-order"];
  return ids.length >= required.length && ids.length <= groupActionIds.length && new Set(ids).size === ids.length
    && required.every((id) => ids.includes(id))
    && ids.every((id) => typeof id === "string" && groupActionIds.includes(id as GroupActionId));
}

export const groupActionIcons: Record<GroupActionId, IconName> = {
  arrange: "grid", preview: "play", "toggle-collapse": "layers", ungroup: "ungroup", delete: "trash",
  "toggle-order": "order", "toggle-scale": "scale", export: "download",
};

export function groupActionLabel(action: GroupActionId, collapsed: boolean, ordered: boolean) {
  switch (action) {
    case "arrange": return "整理";
    case "preview": return "播放预览";
    case "toggle-collapse": return collapsed ? "展开组" : "折叠组";
    case "ungroup": return "解散组";
    case "delete": return "删除组";
    case "toggle-order": return ordered ? "转为普通组" : "设为有序组";
    case "toggle-scale": return "内容随组缩放";
    case "export": return "导出压缩包";
  }
}
