"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/components/app-icon";
import { moveQuickAction, normalizeQuickActions, type QuickAction, type QuickActionLayout, type QuickActionZone } from "./quick-actions";
import styles from "./canvas.module.css";

type Props = {
  typeLabel: string;
  actions: QuickAction[];
  initialLayout: QuickActionLayout;
  onClose: () => void;
  onSave: (layout: QuickActionLayout) => void;
};

type DropTarget = { zone: QuickActionZone; index: number };

export function QuickActionDialog({ typeLabel, actions, initialLayout, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(() => normalizeQuickActions(actions, initialLayout));
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const drop = (event: React.DragEvent, zone: QuickActionZone, index: number) => {
    event.preventDefault();
    const action = event.dataTransfer.getData("application/x-mowo-quick-action") as string;
    if (dragging !== action || !actions.some((item) => item.id === action)) return;
    setDraft((current) => moveQuickAction(current, action, zone, index));
    setDragging(null);
    setDropTarget(null);
  };
  return createPortal(
    <div className={styles.groupConfigBackdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="配置快捷工具" aria-modal="true" className={`${styles.groupConfigDialog} nodrag nopan nowheel`} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
        if (event.key === "Tab") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} role="dialog">
        <header><div><strong>{typeLabel}快捷工具</strong><p>拖动卡片调整顺序，拖到另一栏即可移动操作。</p></div><button autoFocus aria-label="关闭配置快捷工具" onClick={onClose} type="button">×</button></header>
        <div className={styles.groupConfigZones}>
          {(["toolbar", "more"] as const).map((zone) => <div className={styles.groupConfigZone} key={zone}
            onDragOver={(event) => { event.preventDefault(); if (event.target === event.currentTarget) setDropTarget({ zone, index: draft[zone].length }); }}
            onDrop={(event) => drop(event, zone, dropTarget?.zone === zone ? dropTarget.index : draft[zone].length)}>
            <div className={styles.groupConfigZoneHeading}><strong>{zone === "toolbar" ? "外侧快捷栏" : "更多操作"}</strong><small>{draft[zone].length} 项</small></div>
            {draft[zone].map((action, index) => <div key={action}>
              {dragging && dropTarget?.zone === zone && dropTarget.index === index && <div aria-hidden="true" className={styles.groupConfigInsertLine} />}
              <div className={`${styles.groupConfigItem} ${dragging === action ? styles.groupConfigItemDragging : ""}`}
                draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-mowo-quick-action", action); setDragging(action); }}
                onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setDropTarget({ zone, index: index + (event.clientY > rect.top + rect.height / 2 ? 1 : 0) }); }}
                onDrop={(event) => { event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  drop(event, zone, index + (event.clientY > rect.top + rect.height / 2 ? 1 : 0)); }}>
                <span aria-hidden="true" className={styles.groupConfigGrip}>⋮⋮</span><Icon name={actions.find((item) => item.id === action)!.icon} />
                <span className={styles.groupConfigItemLabel}>{actions.find((item) => item.id === action)!.label}</span>
                {zone === "toolbar" && <label className={styles.quickActionLabelToggle} draggable={false}
                  onDragStart={(event) => event.preventDefault()}>
                  <input type="checkbox" checked={draft.showLabels[action]}
                    onChange={(event) => setDraft((current) => ({ ...current, showLabels: { ...current.showLabels, [action]: event.target.checked } }))} />
                  显示文字
                </label>}
              </div>
            </div>)}
            {dragging && dropTarget?.zone === zone && dropTarget.index === draft[zone].length && <div aria-hidden="true" className={styles.groupConfigInsertLine} />}
            {draft[zone].length === 0 && <p className={styles.groupConfigEmpty}>拖动操作到这里</p>}
          </div>)}
        </div>
        <p className={styles.groupConfigNote}>同类卡片共用此配置，保存在本机。更多操作始终显示完整名称。</p>
        {error && <p role="alert">{error}</p>}
        <footer><button onClick={() => setDraft(normalizeQuickActions(actions))} type="button">恢复默认</button><span />
          <button onClick={onClose} type="button">取消</button><button className={styles.groupConfigSave} onClick={() => { try { onSave(draft); } catch { setError("无法保存本机偏好，请检查浏览器存储权限后重试。"); } }} type="button">保存</button></footer>
      </section>
    </div>, document.body);
}
