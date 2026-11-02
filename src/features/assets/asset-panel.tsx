"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/components/app-icon";
import { ASSET_DRAG_TYPE, type AssetProjectSummary, type AssetSummary, type AssetType } from "./types";
import styles from "./asset-ui.module.css";

type AssetFilter = "all" | AssetType;

const filters: Array<{ value: AssetFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "text", label: "文字" },
];

function formatSize(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AssetCard({ asset }: { asset: AssetSummary }) {
  const onDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(asset));
  };

  return (
    <article className={styles.assetCard} draggable onDragStart={onDragStart} title="拖到画布创建模块">
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

export function AssetPanel({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [query, setQuery] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { assets: AssetSummary[] }) => setAssets(payload.assets));
  }, [projectId]);

  const visibleAssets = useMemo(() => assets.filter((asset) => {
    const matchesType = filter === "all" || asset.type === filter;
    return matchesType && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [assets, filter, query]);

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

      <div className={styles.assetSectionTitle}><strong>当前项目资产</strong><span>{assets.length}</span></div>
      <div className={styles.assetFilters}>
        {filters.map((item) => <button className={filter === item.value ? styles.filterActive : ""} key={item.value} onClick={() => setFilter(item.value)} type="button">{item.label}</button>)}
      </div>

      {message ? <div className={styles.assetMessage} aria-live="polite">{message}</div> : null}
      {pending ? <div className={styles.assetEmpty}>正在导入图片…</div> : visibleAssets.length ? (
        <div className={styles.assetGrid}>{visibleAssets.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>
      ) : (
        <div className={styles.assetEmpty}>
          <Icon name="image" />
          <strong>{assets.length ? "没有匹配的资产" : "当前项目还没有资产"}</strong>
          <span>点击“添加”从本地或历史画布加入</span>
        </div>
      )}

      {historyOpen ? <HistoryAssetDialog currentProjectId={projectId} onClose={() => setHistoryOpen(false)} onReferenced={setAssets} /> : null}
    </div>
  );
}
