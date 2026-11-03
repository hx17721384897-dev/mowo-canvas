"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/components/app-icon";
import type { DownloadTaskSummary } from "./downloaders/types";
import styles from "./asset-ui.module.css";

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const activeStatuses = new Set(["queued", "resolving", "downloading", "importing"]);
const resumableStatuses = new Set(["queued", "resolving", "downloading", "ready"]);

export function ImageDownloadModal({ projectId, onClose, onImported }: {
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [url, setUrl] = useState("");
  const [task, setTask] = useState<DownloadTaskSummary | null>(null);
  const [message, setMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [playbackKey, setPlaybackKey] = useState(0);
  const [confirmImport, setConfirmImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskStatusRef = useRef<DownloadTaskSummary["status"] | null>(null);
  const storageKey = `mowo:line-download:${projectId}`;

  const acceptTask = useCallback((next: DownloadTaskSummary) => {
    const becameReady = next.status === "ready" && taskStatusRef.current !== "ready";
    taskStatusRef.current = next.status;
    setTask(next);
    if (becameReady) {
      setSelected(new Set(next.items.map((item) => item.id)));
      setActiveIndex(0);
      setPlaying(true);
    }
  }, []);

  useEffect(() => {
    const savedTaskId = window.sessionStorage.getItem(storageKey);
    if (!savedTaskId) return;
    fetch(`/api/download-tasks/${savedTaskId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { task?: DownloadTaskSummary }) => {
        if (payload.task && resumableStatuses.has(payload.task.status)) acceptTask(payload.task);
        else window.sessionStorage.removeItem(storageKey);
      })
      .catch(() => window.sessionStorage.removeItem(storageKey));
  }, [acceptTask, storageKey]);

  useEffect(() => {
    if (!task || !activeStatuses.has(task.status)) return;
    const timer = window.setInterval(() => {
      fetch(`/api/download-tasks/${task.id}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { task?: DownloadTaskSummary; error?: string }) => {
          if (payload.task) acceptTask(payload.task);
          else if (payload.error) setMessage(payload.error);
        })
        .catch(() => setMessage("无法读取下载进度"));
    }, 800);
    return () => window.clearInterval(timer);
  }, [acceptTask, task]);

  const current = task?.items[activeIndex] ?? null;
  const isBusy = Boolean(task && activeStatuses.has(task.status));
  const unselectedCount = task ? task.items.length - selected.size : 0;
  const progress = task?.total ? Math.round(task.progress / task.total * 100) : 0;

  const statusText = useMemo(() => {
    if (!task) return "";
    if (task.status === "queued") return "任务已创建，正在等待…";
    if (task.status === "resolving") return "正在读取 LINE 商品信息…";
    if (task.status === "downloading") return `正在下载 ${task.progress} / ${task.total}`;
    if (task.status === "ready") return `下载完成，共 ${task.items.length} 项`;
    if (task.status === "failed") return task.errorMessage ?? "下载失败";
    if (task.status === "cancelled") return "下载已取消";
    if (task.status === "importing") return "正在导入资产…";
    return "导入完成";
  }, [task]);

  const startDownload = async () => {
    setMessage("");
    setTask(null);
    setSelected(new Set());
    setConfirmImport(false);
    try {
      const response = await fetch("/api/download-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url: url.trim() }),
      });
      const payload = await response.json() as { task?: DownloadTaskSummary; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? "无法创建下载任务");
      window.sessionStorage.setItem(storageKey, payload.task.id);
      acceptTask(payload.task);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法创建下载任务");
    }
  };

  const closeOrCancel = async () => {
    if (task && resumableStatuses.has(task.status)) {
      await fetch(`/api/download-tasks/${task.id}`, { method: "DELETE" }).catch(() => undefined);
    }
    window.sessionStorage.removeItem(storageKey);
    onClose();
  };

  const toggleSelected = (id: string) => {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePlayback = () => {
    if (!current?.animated) return;
    if (playing && imageRef.current && canvasRef.current) {
      const image = imageRef.current;
      const canvas = canvasRef.current;
      canvas.width = image.naturalWidth || 320;
      canvas.height = image.naturalHeight || 320;
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      setPlaying(false);
    } else {
      setPlaybackKey((value) => value + 1);
      setPlaying(true);
    }
  };

  const importSelected = async (discardUnselected: boolean) => {
    if (!task || task.status !== "ready" || !selected.size) return;
    setImporting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/download-tasks/${task.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [...selected], discardUnselected }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "导入失败");
      window.sessionStorage.removeItem(storageKey);
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
      setConfirmImport(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && void closeOrCancel()}>
      <section aria-modal="true" className={styles.downloadDialog} role="dialog">
        <header className={styles.downloadHeader}>
          <span className={styles.downloadTitleIcon}><Icon name="download" /></span>
          <div><strong>下载图片</strong><span>LINE 贴纸与表情包 · 导入前预览并选择</span></div>
          <button aria-label="关闭" onClick={() => void closeOrCancel()} type="button">×</button>
        </header>
        <div className={styles.urlBar}>
          <Icon name="layers" />
          <input disabled={isBusy} onChange={(event) => setUrl(event.target.value)} placeholder="粘贴 LINE 贴纸或表情包链接" value={url} />
          <button disabled={isBusy || !url.trim()} onClick={() => void startDownload()} type="button">{isBusy ? "下载中…" : "下载"}</button>
        </div>
        {statusText ? <div className={`${styles.downloadNotice} ${task?.status === "failed" ? styles.downloadError : ""}`} role="status">
          <span>{statusText}</span>{isBusy && task?.total ? <span>{progress}%</span> : null}
        </div> : null}
        {message ? <div className={`${styles.downloadNotice} ${styles.downloadError}`} role="alert">{message}</div> : null}
        <div className={styles.downloadBody}>
          <section className={styles.previewPane}>
            <div className={styles.previewStage}>
              {current ? (
                <>
                  <Image key={`${current.id}-${playbackKey}`} alt={current.name} className={!playing ? styles.previewHidden : ""} fill ref={imageRef} sizes="520px" src={current.previewUrl} unoptimized />
                  <canvas className={playing ? styles.previewHidden : ""} ref={canvasRef} />
                </>
              ) : <><Icon name="image" /><span>{isBusy ? "正在准备下载结果" : "下载完成后在这里预览静态图或动图"}</span></>}
            </div>
            <div className={styles.previewControls}>
              <button disabled={!task?.items.length || activeIndex === 0} onClick={() => { setActiveIndex((value) => value - 1); setPlaying(true); }} type="button"><Icon name="chevron-left" />上一张</button>
              <span>{task?.items.length ? `${activeIndex + 1} / ${task.items.length}` : "0 / 0"}</span>
              <button disabled={!current?.animated} onClick={togglePlayback} type="button">{playing ? "Ⅱ 暂停" : "▶ 播放"}</button>
              <button disabled={!task?.items.length || activeIndex >= task.items.length - 1} onClick={() => { setActiveIndex((value) => value + 1); setPlaying(true); }} type="button">下一张<Icon name="chevron-right" /></button>
            </div>
            <dl className={styles.previewMeta}><div><dt>文件名</dt><dd>{current?.name ?? "—"}</dd></div><div><dt>格式</dt><dd>{current?.animated ? "APNG" : current ? "PNG" : "—"}</dd></div><div><dt>大小</dt><dd>{current ? formatSize(current.size) : "—"}</dd></div></dl>
          </section>
          <section className={styles.downloadSelection}>
            <header>
              <div className={styles.selectionHeading}>
                <strong>已下载图片</strong>
                {current?.animated ? <span className={styles.animatedBadge}>APNG 动图</span> : null}
              </div>
              <button disabled={!task?.items.length} onClick={() => setSelectionMode((value) => !value)} type="button">{selectionMode ? "完成选择" : "选择"}</button>
              <span>已选择 {selected.size} / {task?.items.length ?? 0}</span>
            </header>
            {task?.items.length ? <div className={styles.thumbnailGrid}>
              {task.items.map((item, index) => {
                const checked = selected.has(item.id);
                return <button className={`${styles.thumbnailCard} ${activeIndex === index ? styles.thumbnailActive : ""} ${!checked ? styles.thumbnailUnchecked : ""}`} key={item.id} onClick={() => {
                  setActiveIndex(index);
                  setPlaying(true);
                  if (selectionMode) toggleSelected(item.id);
                }} type="button">
                  <span className={styles.thumbnailImage}><Image alt="" fill sizes="90px" src={item.previewUrl} unoptimized /></span>
                  {selectionMode ? <span className={`${styles.thumbnailCheck} ${checked ? styles.thumbnailChecked : ""}`}>{checked ? "✓" : ""}</span> : null}
                  <span className={styles.thumbnailLabel}>{item.name}</span>
                </button>;
              })}
            </div> : <div className={styles.thumbnailEmpty}><Icon name="grid" /><span>等待下载结果</span><small>支持 LINE 动态贴纸、静态贴纸与动画表情包</small></div>}
          </section>
        </div>
        <footer className={styles.dialogFooter}>
          <span>{task?.id ? `任务 ${task.id.slice(0, 8)}` : "下载文件先进入临时区，确认后才加入资产"}</span>
          <button onClick={() => void closeOrCancel()} type="button">取消</button>
          <button className={styles.primaryAction} disabled={task?.status !== "ready" || !selected.size || importing} onClick={() => unselectedCount ? setConfirmImport(true) : void importSelected(true)} type="button">{importing ? "导入中…" : "导入"}</button>
        </footer>
        {confirmImport ? <div className={styles.importConfirm}>
          <div><strong>如何处理 {unselectedCount} 个未勾选文件？</strong><span>选中的图片会加入当前项目资产。</span></div>
          <button disabled={importing} onClick={() => void importSelected(false)} type="button">保留到下载归档</button>
          <button className={styles.dangerAction} disabled={importing} onClick={() => void importSelected(true)} type="button">删除未勾选文件</button>
          <button aria-label="返回" disabled={importing} onClick={() => setConfirmImport(false)} type="button">×</button>
        </div> : null}
      </section>
    </div>
  );
}
