"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/components/app-icon";
import { ASSET_DRAG_TYPE, type AssetProjectSummary, type AssetSummary, type AssetType } from "./types";
import styles from "./asset-ui.module.css";

type AssetFilter = "all" | AssetType;
type AssetScope = "project" | "on-canvas" | "off-canvas";

const filters: Array<{ value: AssetFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "text", label: "文字" },
];

const scopes: Array<{ value: AssetScope; label: string }> = [
  { value: "project", label: "当前项目资产" },
  { value: "on-canvas", label: "画布上的资产" },
  { value: "off-canvas", label: "未在画布上的资产" },
];

function formatSize(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AssetCard({ asset, onLocate }: { asset: AssetSummary; onLocate?: () => void }) {
  const onDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(asset));
  };

  return (
    <article
      className={`${styles.assetCard} ${onLocate ? styles.assetCardLocatable : ""}`}
      draggable
      onClick={onLocate}
      onDragStart={onDragStart}
      onKeyDown={(event) => {
        if (!onLocate || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onLocate();
      }}
      role={onLocate ? "button" : undefined}
      tabIndex={onLocate ? 0 : undefined}
      title={onLocate ? "点击定位到画布位置；拖动可再次创建模块" : "拖到画布创建模块"}
    >
      <div className={styles.assetPreview}>
        {asset.previewUrl ? (
          <Image alt={asset.name} fill sizes="90px" src={asset.previewUrl} unoptimized />
        ) : (
          <Icon name={asset.type === "video" ? "video" : asset.type === "text" ? "text" : "image"} />
        )}
        {asset.type === "video" && asset.duration ? <span className={styles.duration}>{asset.duration}s</span> : null}
      </div>
      <span className={styles.assetName}>{asset.name}</span>
      <span className={styles.assetMeta}>{asset.type === "image" ? formatSize(asset.size) : asset.type === "text" ? "文字资产" : "视频资产"}</span>
    </article>
  );
}

function HistoryAssetDialog({ currentProjectId, onClose, onReferenced }: {
  currentProjectId: string;
  onClose: () => void;
  onReferenced: (assets: AssetSummary[]) => void;
}) {
  const [projects, setProjects] = useState<AssetProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch(`/api/projects?exclude=${encodeURIComponent(currentProjectId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { projects: AssetProjectSummary[] }) => {
        setProjects(payload.projects);
        setProjectId(payload.projects[0]?.id ?? "");
      });
  }, [currentProjectId]);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { assets: AssetSummary[] }) => setAssets(payload.assets));
  }, [projectId]);

  const referenceSelected = async () => {
    if (selected.size === 0) return;
    setPending(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/assets/reference`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [...selected] }),
      });
      const payload = await response.json() as { assets?: AssetSummary[]; error?: string };
      if (!response.ok || !payload.assets) throw new Error(payload.error ?? "添加失败");
      onReferenced(payload.assets);
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className={styles.historyDialog} role="dialog">
        <header className={styles.dialogHeader}>
          <div><strong>从历史画布添加</strong><span>只建立引用，不会复制原文件</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </header>
        <div className={styles.historyBody}>
          <nav className={styles.projectList} aria-label="历史画布">
            {projects.map((project) => (
              <button className={project.id === projectId ? styles.projectActive : ""} key={project.id} onClick={() => { setSelected(new Set()); setProjectId(project.id); }} type="button">
                <span>{project.name}</span><small>{project.assetCount} 项</small>
              </button>
            ))}
          </nav>
          <div className={styles.historyAssets}>
            {assets.length ? assets.map((asset) => (
              <label className={styles.historyAsset} key={asset.id}>
                <input checked={selected.has(asset.id)} onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(asset.id); else next.delete(asset.id);
                  setSelected(next);
                }} type="checkbox" />
                <span>{asset.name}</span><small>{asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "文字"}</small>
              </label>
            )) : <div className={styles.historyEmpty}>这个画布还没有资产</div>}
          </div>
        </div>
        <footer className={styles.dialogFooter}>
          <span>已选择 {selected.size} 项</span>
          <button onClick={onClose} type="button">取消</button>
          <button className={styles.primaryAction} disabled={!selected.size || pending} onClick={referenceSelected} type="button">{pending ? "添加中…" : "添加引用"}</button>
        </footer>
      </section>
    </div>
  );
}

export function AssetPanel({ canvasAssetIds, onLocateAsset, projectId, refreshKey = 0 }: {
  canvasAssetIds: ReadonlySet<string>;
  onLocateAsset?: (assetId: string) => void;
  projectId: string;
  refreshKey?: number;
}) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [scope, setScope] = useState<AssetScope>("project");
  const [query, setQuery] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [scrollThumb, setScrollThumb] = useState({ height: 0, top: 0, visible: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const scrollHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollDragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { assets: AssetSummary[] }) => setAssets(payload.assets));
  }, [projectId, refreshKey]);

  const scopedAssets = useMemo(() => assets.filter((asset) => {
    if (scope === "on-canvas") return canvasAssetIds.has(asset.id);
    if (scope === "off-canvas") return !canvasAssetIds.has(asset.id);
    return true;
  }), [assets, canvasAssetIds, scope]);

  const visibleAssets = useMemo(() => scopedAssets.filter((asset) => {
    const matchesType = filter === "all" || asset.type === filter;
    return matchesType && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [filter, query, scopedAssets]);

  const updateScrollThumb = useCallback((visible?: boolean) => {
    const scroller = scrollRef.current;
    const viewportElement = scrollViewportRef.current;
    if (!scroller || !viewportElement) return;
    const trackHeight = Math.max(0, viewportElement.clientHeight - 8);
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 1 || trackHeight <= 0) {
      setScrollThumb({ height: 0, top: 0, visible: false });
      return;
    }
    const height = Math.max(28, trackHeight * (scroller.clientHeight / scroller.scrollHeight));
    const travel = trackHeight - height;
    const top = 4 + travel * (scroller.scrollTop / maxScroll);
    setScrollThumb((current) => ({ height, top, visible: visible ?? current.visible }));
  }, []);

  const scheduleScrollThumbHide = useCallback(() => {
    if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    scrollHideTimerRef.current = setTimeout(() => {
      setScrollThumb((current) => ({ ...current, visible: false }));
    }, 700);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => updateScrollThumb(false));
    const resizeObserver = new ResizeObserver(() => updateScrollThumb(false));
    if (scrollRef.current) resizeObserver.observe(scrollRef.current);
    if (scrollViewportRef.current) resizeObserver.observe(scrollViewportRef.current);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [updateScrollThumb, visibleAssets.length]);

  useEffect(() => () => {
    if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
  }, []);

  const onAssetScroll = () => {
    updateScrollThumb(true);
    scheduleScrollThumbHide();
  };

  const onScrollThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollDragRef.current = { pointerY: event.clientY, scrollTop: scroller.scrollTop };
    if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    setScrollThumb((current) => ({ ...current, visible: true }));
  };

  const onScrollThumbPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    const viewportElement = scrollViewportRef.current;
    const drag = scrollDragRef.current;
    if (!scroller || !viewportElement || !drag) return;
    const trackHeight = viewportElement.clientHeight - 8;
    const travel = trackHeight - scrollThumb.height;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (travel <= 0 || maxScroll <= 0) return;
    scroller.scrollTop = drag.scrollTop + (event.clientY - drag.pointerY) * (maxScroll / travel);
  };

  const onScrollThumbPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    scrollDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    scheduleScrollThumbHide();
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setPending(true);
    setMessage("");
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body: formData });
      const payload = await response.json() as { assets?: AssetSummary[]; importedIds?: string[]; error?: string };
      if (!response.ok || !payload.assets) throw new Error(payload.error ?? "导入失败");
      setAssets(payload.assets);
      setMessage(`已添加 ${payload.importedIds?.length ?? files.length} 项资产`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={styles.assetPanel}>
      <div className={styles.assetActions}>
        <label className={styles.assetSearch}>
          <Icon name="search" />
          <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产" type="search" value={query} />
        </label>
        <div className={styles.addMenuWrap}>
          <button className={styles.addButton} onClick={() => setAddMenuOpen((open) => !open)} type="button"><Icon name="plus" />添加</button>
          {addMenuOpen ? (
            <div className={styles.addMenu}>
              <button onClick={() => { setAddMenuOpen(false); inputRef.current?.click(); }} type="button"><Icon name="upload" /><span>从本地添加<small>PNG、JPEG、WebP、GIF</small></span></button>
              <button onClick={() => { setAddMenuOpen(false); setHistoryOpen(true); }} type="button"><Icon name="folder" /><span>从历史画布添加<small>复用资产，不复制文件</small></span></button>
            </div>
          ) : null}
        </div>
        <input accept="image/png,image/jpeg,image/webp,image/gif" hidden multiple onChange={(event) => void importFiles(event.target.files)} ref={inputRef} type="file" />
      </div>

      <div className={styles.assetSectionTitle}>
        <select aria-label="资产范围" className={styles.assetScopeSelect} onChange={(event) => setScope(event.target.value as AssetScope)} value={scope}>
          {scopes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <span>{scopedAssets.length}</span>
      </div>
      <div className={styles.assetFilters}>
        {filters.map((item) => <button className={filter === item.value ? styles.filterActive : ""} key={item.value} onClick={() => setFilter(item.value)} type="button">{item.label}</button>)}
      </div>

      {message ? <div className={styles.assetMessage} aria-live="polite">{message}</div> : null}
      <div className={styles.assetListViewport} ref={scrollViewportRef}>
        <div className={styles.assetListScroller} data-asset-scroll-container onScroll={onAssetScroll} ref={scrollRef}>
          <div className={styles.assetListContent}>
            {pending ? <div className={styles.assetEmpty}>正在导入图片…</div> : visibleAssets.length ? (
              <div className={styles.assetGrid}>{visibleAssets.map((asset) => <AssetCard asset={asset} key={asset.id} onLocate={scope === "on-canvas" ? () => onLocateAsset?.(asset.id) : undefined} />)}</div>
            ) : (
              <div className={styles.assetEmpty}>
                <Icon name="image" />
                <strong>{assets.length ? "这个范围内没有匹配的资产" : "当前项目还没有资产"}</strong>
                <span>{assets.length ? "可切换资产范围或调整筛选条件" : "点击“添加”从本地或历史画布加入"}</span>
              </div>
            )}
          </div>
        </div>
        {scrollThumb.height ? (
          <div
            aria-hidden="true"
            className={`${styles.assetScrollThumb} ${scrollThumb.visible ? styles.assetScrollThumbVisible : ""}`}
            onPointerCancel={onScrollThumbPointerUp}
            onPointerDown={onScrollThumbPointerDown}
            onPointerMove={onScrollThumbPointerMove}
            onPointerUp={onScrollThumbPointerUp}
            style={{ height: scrollThumb.height, transform: `translateY(${scrollThumb.top}px)` }}
          />
        ) : null}
      </div>

      {historyOpen ? <HistoryAssetDialog currentProjectId={projectId} onClose={() => setHistoryOpen(false)} onReferenced={setAssets} /> : null}
    </div>
  );
}
