"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { Icon } from "@/app/components/app-icon";
import type { QuickAction } from "./quick-actions";
import { QuickActionDialog } from "./quick-action-dialog";
import { useQuickActionPreferences } from "./quick-action-preferences";
import styles from "./canvas.module.css";

export function NodeQuickToolbar({ kind, typeLabel, actions, legacyLayout, children }: {
  kind: string;
  typeLabel: string;
  actions: QuickAction[];
  legacyLayout?: unknown;
  children?: ReactNode;
}) {
  const { layout, save } = useQuickActionPreferences(kind, actions, legacyLayout);
  const [configOpen, setConfigOpen] = useState(false);
  const [width, setWidth] = useState(1600);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const surface = anchorRef.current?.closest(".react-flow");
    const resize = () => setWidth(surface?.getBoundingClientRect().width ?? window.innerWidth);
    resize();
    const observer = new ResizeObserver(resize);
    if (surface) observer.observe(surface);
    window.addEventListener("resize", resize);
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) moreRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); document.removeEventListener("pointerdown", close); };
  }, []);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const available = (ids: string[]) => ids.map((id) => byId.get(id)!).filter((action) => action.visible !== false);
  const configured = available(layout.toolbar);
  let maximum = 0;
  let occupied = 44;
  for (const action of configured) {
    const cost = layout.showLabels[action.id] ? 44 + action.label.length * 13 : 40;
    if (maximum > 0 && (occupied + cost > width - 40 || maximum >= 6)) break;
    occupied += cost;
    maximum++;
  }
  const toolbar = configured.slice(0, maximum);
  const more = [...configured.slice(maximum), ...available(layout.more)];
  const render = (action: QuickAction, outside: boolean) => {
    const showLabel = !outside || layout.showLabels[action.id];
    const className = `${outside ? showLabel ? styles.groupSelectionButton : "" : styles.groupMoreMenuRow} ${action.danger ? styles.deleteImageAction : ""} nodrag nopan`;
    const content = <><Icon name={action.icon} />{showLabel && <span>{action.label}</span>}
      {!outside && action.pressed !== undefined && <span aria-hidden="true" className={`${styles.groupMenuSwitch} ${action.pressed ? styles.groupMenuSwitchOn : ""}`} />}</>;
    if (action.href && !action.disabled) return <a key={action.id} aria-label={action.label} className={className}
      href={action.href} download={action.download} title={action.title ?? action.label}
      onClick={() => moreRef.current?.removeAttribute("open")}>{content}</a>;
    return <button key={action.id} aria-label={action.label} aria-pressed={action.pressed} className={className}
      disabled={action.disabled} title={action.title ?? action.label} type="button"
      onClick={() => { moreRef.current?.removeAttribute("open"); action.run?.(); }}>{content}</button>;
  };
  const closeConfig = () => {
    setConfigOpen(false);
    moreRef.current?.querySelector<HTMLElement>("summary")?.focus();
  };
  return <>
    <span hidden ref={anchorRef} />
    <NodeToolbar className={styles.imageToolbar} offset={14} position={Position.Top}>
      {toolbar.map((action) => render(action, true))}
      <details className={`${styles.groupMoreMenu} nodrag nopan`} ref={moreRef}>
        <summary aria-label={`${typeLabel}更多操作`} title="更多操作"><Icon name="more" /></summary>
        <div className={styles.groupMoreMenuPanel}>
          {more.map((action) => render(action, false))}
          {more.length > 0 && <div className={styles.groupMoreMenuDivider} />}
          <button className={styles.groupMoreMenuRow} type="button"
            onClick={() => { moreRef.current?.removeAttribute("open"); setConfigOpen(true); }}>
            <Icon name="settings" /><span>配置快捷工具</span>
          </button>
        </div>
      </details>
      {children}
    </NodeToolbar>
    {configOpen && <QuickActionDialog typeLabel={typeLabel} actions={actions} initialLayout={layout}
      onClose={closeConfig} onSave={(next) => { save(next); closeConfig(); }} />}
  </>;
}
