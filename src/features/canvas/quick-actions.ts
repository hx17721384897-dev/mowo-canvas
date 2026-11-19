import type { IconName } from "@/app/components/app-icon";

export type QuickActionZone = "toolbar" | "more";
export type QuickActionLayout = {
  version: 1;
  toolbar: string[];
  more: string[];
  showLabels: Record<string, boolean>;
};
export type QuickActionDefault = {
  id: string;
  defaultZone?: QuickActionZone;
  defaultShowLabel?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeQuickActions(actions: QuickActionDefault[], value?: unknown): QuickActionLayout {
  const saved = record(value) && (value.version === undefined || value.version === 1) ? value : {};
  const known = new Set(actions.map((action) => action.id));
  const seen = new Set<string>();
  const readZone = (zone: QuickActionZone) => {
    const items = saved[zone];
    if (!Array.isArray(items)) return [];
    return items.filter((id): id is string => {
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  const toolbar = readZone("toolbar");
  const more = readZone("more");
  const labels = record(saved.showLabels) ? saved.showLabels : {};
  const showLabels: Record<string, boolean> = {};
  for (const action of actions) {
    if (!seen.has(action.id)) (action.defaultZone === "more" ? more : toolbar).push(action.id);
    showLabels[action.id] = typeof labels[action.id] === "boolean"
      ? labels[action.id] as boolean : action.defaultShowLabel ?? false;
  }
  return { version: 1, toolbar, more, showLabels };
}

export function moveQuickAction(layout: QuickActionLayout, id: string, zone: QuickActionZone, index: number): QuickActionLayout {
  const oldZone = layout.toolbar.includes(id) ? "toolbar" : "more";
  const oldIndex = layout[oldZone].indexOf(id);
  if (oldIndex < 0) return layout;
  const next = { ...layout, toolbar: layout.toolbar.filter((item) => item !== id), more: layout.more.filter((item) => item !== id) };
  const insertion = oldZone === zone && oldIndex < index ? index - 1 : index;
  next[zone].splice(Math.max(0, Math.min(insertion, next[zone].length)), 0, id);
  return next;
}

export type QuickAction = QuickActionDefault & {
  label: string;
  icon: IconName;
  run?: () => void;
  href?: string;
  download?: string;
  visible?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
  title?: string;
};
