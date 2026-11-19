"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectSummary } from "@/features/projects/types";
import { Icon } from "./app-icon";
import { NewCanvasButton } from "./new-canvas-button";
import styles from "../ui-shell.module.css";

type ProjectCard = ProjectSummary & { coverId?: string; nodes: number; edges: number };

function formatUpdatedAt(value: string) {
  return `${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value))} 更新`;
}

export function ProjectList({ cards }: { cards: ProjectCard[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const selectedCards = cards.filter((card) => selected.has(card.id) && !removed.has(card.id));
  const [sort, setSort] = useState("created");
  const [query, setQuery] = useState("");
  const visibleCards = cards.filter((card) => !removed.has(card.id) && card.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  if (sort === "updated") visibleCards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === "oldest") visibleCards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function removeSelected() {
    if (busy || !selectedCards.length) return;
    const names = selectedCards.map((card) => `「${card.name}」`).join("、");
    if (!window.confirm(`将删除 ${selectedCards.length} 个画布 ${names}，里面的节点和连线也会一起移除。`)) return;
    const ids = selectedCards.map((card) => card.id);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error();
      setRemoved((previous) => new Set([...previous, ...ids]));
      setSelected(new Set());
      setSelecting(false);
      router.refresh();
    } catch {
      setError("批量删除失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function changeProject(id: string, name?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, name === undefined
        ? { method: "DELETE" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error(name === undefined ? "删除画布失败，请重试。" : "重命名失败，请检查名称后重试。");
      setEditing(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
        <header className={styles.homeHeader}>
          <h1>我的画布</h1>
          <div className={styles.homeHeaderActions}>
            {selecting ? <button className={styles.batchDeleteButton} type="button" disabled={busy || !selectedCards.length} onClick={() => void removeSelected()}>删除选中{selectedCards.length ? `（${selectedCards.length}）` : ""}</button> : null}
            <button type="button" aria-pressed={selecting} disabled={busy} onClick={() => {
              setSelecting(!selecting);
              setEditing(null);
              setSelected(new Set());
            }}>{selecting ? "取消选择" : "选择"}</button>
            <NewCanvasButton className={styles.primaryButton} />
          </div>
        </header>
        <div className={styles.projectControls}>
          <label className={styles.searchField}>
            <Icon name="search" />
            <input aria-label="搜索画布" placeholder="搜索画布" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <select aria-label="画布排序" className={styles.sortButton} value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="created">最新创建</option>
            <option value="updated">最近更新</option>
            <option value="oldest">最早创建</option>
          </select>
        </div>

        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.projectGrid}>
          {!visibleCards.length ? <p>{cards.length ? "没有匹配的画布。" : "还没有画布，点击右上角「新建画布」开始。"}</p> : null}
          {visibleCards.map((project) => (
            <article className={`${styles.projectCard} ${selected.has(project.id) ? styles.selectedProject : ""}`} key={project.id}>
              <div className={styles.projectPreview}>
                {project.coverId ? <Image alt="" fill sizes="(max-width: 700px) 100vw, 33vw" src={`/api/assets/${encodeURIComponent(project.coverId)}/content`} unoptimized /> : <div className={styles.emptyProjectPreview}><span><Icon name="layout" /></span><strong>{project.name}</strong></div>}
                {!selecting ? <Link aria-label={`进入${project.name}`} className={styles.projectOverlay} href={`/canvas/${project.id}`} /> : null}
              </div>
              {selecting ? <button className={styles.projectOverlay} type="button" disabled={busy} aria-label={`选择 ${project.name}`} aria-pressed={selected.has(project.id)} onClick={() => {
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                  return next;
                });
              }}><span className={styles.projectCheckbox} aria-hidden="true">{selected.has(project.id) ? "✓" : ""}</span></button> : null}
              <div className={styles.projectInfo}>
                {editing?.id === project.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); if (editing.name.trim()) void changeProject(project.id, editing.name); }}>
                    <input aria-label="画布名称" title="Enter 保存，Esc 取消" autoFocus maxLength={80} required value={editing.name}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setEditing({ id: project.id, name: event.target.value })}
                      onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} />
                    <button type="submit" disabled={busy || !editing.name.trim()}>保存</button>
                  </form>
                ) : <h2>{selecting ? project.name : <Link href={`/canvas/${project.id}`}>{project.name}</Link>}</h2>}
                <p>{project.nodes} 个节点 · {project.edges} 条连线</p>
                <footer className={styles.projectActions}>
                  <time dateTime={project.updatedAt}>{formatUpdatedAt(project.updatedAt)}</time>
                  {!selecting ? <><button type="button" aria-label={`重命名 ${project.name}`} title="重命名" disabled={busy} onClick={() => setEditing({ id: project.id, name: project.name })}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4" /></svg>
                  </button>
                  <button type="button" aria-label={`删除 ${project.name}`} title="删除" disabled={busy} onClick={() => {
                    if (window.confirm(`将删除 1 个画布「${project.name}」，里面的节点和连线也会一起移除。`)) void changeProject(project.id);
                  }}><Icon name="trash" /></button></> : null}
                </footer>
              </div>
            </article>
          ))}
        </div>
    </>
  );
}
