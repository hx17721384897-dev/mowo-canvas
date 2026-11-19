"use client";

import Image from "next/image";
import Link from "next/link";
import { useProgressNavigation } from "@/components/navigation-progress";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/components/app-icon";
import { ASSET_DRAG_TYPE, SEQUENCE_DRAG_TYPE, type AssetProjectSummary, type AssetSequence, type AssetSummary, type AssetType } from "./types";
import type { AssetSourceView } from "./asset-source-types";
import { sourceCategory, sourceRelations } from "./asset-source-model";
import { AssetInfoDialog } from "./asset-info-dialog";
import styles from "./asset-ui.module.css";

type AssetFilter = "all" | "sequence" | AssetType;
type AssetScope = "project" | "on-canvas" | "off-canvas";
type SourceCategory = "download" | "import";
type SourcePage = { kind: "category"; category: SourceCategory }
  | { kind: "folder" | "batch" | "asset" | "sequence"; category: SourceCategory; id: string };

const filters: Array<{ value: AssetFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "text", label: "文字" },
  { value: "sequence", label: "序列帧" },
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

function VideoAssetCover({ source, name }: { source: string; name: string }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let video: HTMLVideoElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const release = () => {
      clearTimeout(timer);
      if (!video) return;
      video.onloadeddata = video.onerror = null;
      video.removeAttribute("src");
      video.load();
      video = undefined;
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || stopped) return;
      observer.disconnect();
      video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = () => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (stopped || !canvas || !context || !video?.videoWidth || !video.videoHeight) {
          if (!stopped) setFailed(true);
          release();
          return;
        }
        const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        setReady(true);
        release();
      };
      video.onerror = () => { if (!stopped) setFailed(true); release(); };
      timer = setTimeout(() => { if (!stopped) setFailed(true); release(); }, 20000);
      video.src = source;
    });
    observer.observe(frame);
    return () => { stopped = true; observer.disconnect(); release(); };
  }, [source]);

  return <span ref={frameRef} className={styles.videoAssetCover} role="img"
    aria-label={ready ? `${name} · 首帧封面` : failed ? `${name} · 无法读取首帧` : `${name} · 正在读取首帧`}>
    <canvas ref={canvasRef} hidden={!ready} />
    {!ready && <Icon name="video" />}
  </span>;
}

function AssetCard({ asset, projectId, onLocate, onPlace, onInfo }: { asset: AssetSummary; projectId: string; onLocate?: () => void; onPlace?: () => void; onInfo?: () => void }) {
  const navigate = useProgressNavigation();
  const activate = onLocate ?? onPlace;
  const onDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(asset));
  };

  return (
    <article
      className={`${styles.assetCard} ${activate ? styles.assetCardLocatable : ""}`}
      draggable
      onClick={activate}
      onDragStart={onDragStart}
      onKeyDown={(event) => {
        if (!activate || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        activate();
      }}
      role={activate ? "button" : undefined}
      tabIndex={activate ? 0 : undefined}
      title={onLocate ? "点击定位到画布位置；拖动可再次创建模块" : onPlace ? "点击放到画布中央，或拖到指定位置" : undefined}
    >
      <div className={styles.assetPreview}>
        {asset.previewUrl && asset.type === "image" ? (
          <Image alt={asset.name} fill sizes="90px" src={asset.previewUrl} unoptimized />
        ) : asset.coverUrl && asset.type === "video" ? (
          <Image alt={`${asset.name} · 视频封面`} fill sizes="90px" src={asset.coverUrl} unoptimized />
        ) : asset.previewUrl && asset.type === "video" ? (
          <VideoAssetCover key={asset.previewUrl} source={asset.previewUrl} name={asset.name} />
        ) : (
          <Icon name={asset.type === "video" ? "video" : asset.type === "text" ? "text" : "image"} />
        )}
        {asset.type === "video" && asset.duration ? <span className={styles.duration}>{Math.ceil(asset.duration)}s</span> : null}
        {asset.animated ? <span className={styles.duration}>动图</span> : null}
      </div>
      <span className={styles.assetName}>{asset.name}</span>
      <span className={styles.assetMeta}>{asset.type === "image" ? formatSize(asset.size) : asset.type === "text" ? "文字资产" : asset.clip ? "视频片段" : "视频资产"}</span>
      {onInfo && <button className={styles.assetCardInfo} type="button" onClick={(event) => { event.stopPropagation(); onInfo(); }}>信息</button>}
      {asset.clip && <Link href={`/video-editor/${encodeURIComponent(projectId)}/${encodeURIComponent(asset.clip.sourceAssetId)}?clip=${encodeURIComponent(asset.id)}`}
        onClick={(event) => {
          event.stopPropagation();
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigate(`/video-editor/${encodeURIComponent(projectId)}/${encodeURIComponent(asset.clip!.sourceAssetId)}?clip=${encodeURIComponent(asset.id)}`, "正在打开视频观察页");
        }} onKeyDown={(event) => event.stopPropagation()} draggable={false}>编辑片段</Link>}
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

export function AssetPanel({ canvasAssetIds, onLocateAsset, onLocateSequence, onPlaceAsset, projectId, refreshKey = 0 }: {
  canvasAssetIds: ReadonlySet<string>;
  onLocateAsset?: (assetId: string) => void;
  onLocateSequence?: (sequence: AssetSequence) => void;
  onPlaceAsset?: (asset: AssetSummary) => void;
  projectId: string;
  refreshKey?: number;
}) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [sequences, setSequences] = useState<AssetSequence[]>([]);
  const [sourceView, setSourceView] = useState<AssetSourceView | null>(null);
  const [infoAssetId, setInfoAssetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"flat" | "source">("flat");
  const [sourceTrail, setSourceTrail] = useState<SourcePage[]>([]);
  const [flatSequenceId, setFlatSequenceId] = useState<string | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [newFolderCategory, setNewFolderCategory] = useState<"download" | "import" | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
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
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("读取资产失败");
        const payload = await response.json() as { assets: AssetSummary[]; sequences: AssetSequence[]; sourceView?: AssetSourceView };
        if (!controller.signal.aborted) { setAssets(payload.assets); setSequences(payload.sequences ?? []); setSourceView(payload.sourceView ?? null); }
      })
      .catch(() => { if (!controller.signal.aborted) setMessage("读取资产失败，请刷新后重试。"); });
    return () => controller.abort();
  }, [projectId, refreshKey]);

  const sequenceMemberIds = useMemo(() => new Set(sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.id))), [sequences]);
  const scopedAssets = useMemo(() => assets.filter((asset) => {
    if (sequenceMemberIds.has(asset.id) && asset.sourceType === "frame-extraction") return false;
    if (scope === "on-canvas") return canvasAssetIds.has(asset.id);
    if (scope === "off-canvas") return !canvasAssetIds.has(asset.id);
    return true;
  }), [assets, canvasAssetIds, scope, sequenceMemberIds]);

  const visibleAssets = useMemo(() => scopedAssets.filter((asset) => {
    const matchesType = filter === "all" || asset.type === filter;
    return matchesType && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [filter, query, scopedAssets]);
  const scopedSequences = sequences.filter((sequence) => {
    const count = sequence.frames.filter((frame) => canvasAssetIds.has(frame.id)).length;
    return scope === "project" || (scope === "on-canvas" ? count > 0 : count < sequence.frames.length);
  });
  const visibleSequences = filter === "all" || filter === "sequence" ? scopedSequences.filter((sequence) => {
    const term = query.trim().toLocaleLowerCase();
    return sequence.name.toLocaleLowerCase().includes(term) || sequence.frames.some((frame) => frame.name.toLocaleLowerCase().includes(term));
  }) : [];
  const sourceModel = sourceView ? sourceRelations(sourceView) : null;
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const sequenceById = new Map(sequences.map((sequence) => [sequence.id, sequence]));
  const placementById = new Map(sourceView?.placements.map((item) => [item.assetId, item.folderId]) ?? []);
  const firstBatchByAsset = new Map<string, string>();
  for (const batch of [...(sourceView?.batches ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
    for (const id of batch.assetIds) if (!firstBatchByAsset.has(id)) firstBatchByAsset.set(id, batch.id);
  const refreshSourceView = async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" });
    if (!response.ok) throw new Error("刷新资产来源失败");
    const payload = await response.json() as { assets: AssetSummary[]; sequences: AssetSequence[]; sourceView: AssetSourceView };
    setAssets(payload.assets); setSequences(payload.sequences); setSourceView(payload.sourceView);
  };
  const editFolder = async (method: "POST" | "PATCH", path: string, body: object) => {
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "保存文件夹失败");
      await refreshSourceView(); setNewFolderCategory(null); setNewFolderName("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存文件夹失败"); }
  };
  const deleteFolder = async (folderId: string) => {
    if (!window.confirm("删除文件夹？素材会回到来源列表，资产文件不会删除。")) return false;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/asset-folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "删除文件夹失败");
      await refreshSourceView();
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除文件夹失败"); return false; }
  };
  const moveToFolder = async (assetId: string, folderId: string | null) => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/asset-folders/placement`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId, folderId }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "移动失败");
      await refreshSourceView();
    } catch (error) { setMessage(error instanceof Error ? error.message : "移动失败"); }
  };
  const sourceMatchesAsset = (asset: AssetSummary) =>
    (filter === "all" || filter === asset.type)
    && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (scope === "project" || (scope === "on-canvas" ? canvasAssetIds.has(asset.id) : !canvasAssetIds.has(asset.id)));
  const sourceMatchesSequence = (sequence: AssetSequence) =>
    (filter === "all" || filter === "sequence")
    && (sequence.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      || sequence.frames.some((frame) => frame.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    && (scope === "project" || sequence.frames.some((frame) =>
      scope === "on-canvas" ? canvasAssetIds.has(frame.id) : !canvasAssetIds.has(frame.id)));
  const relatedFor = (assetId: string) => {
    const relation = sourceModel?.related.get(assetId);
    return {
      assets: (relation?.assetIds ?? []).map((id) => assetById.get(id)).filter((item): item is AssetSummary => Boolean(item)),
      sequences: (relation?.sequenceIds ?? []).map((id) => sequenceById.get(id)).filter((item): item is AssetSequence => Boolean(item)),
    };
  };
  const sourceAssetVisible = (assetId: string) => {
    const asset = assetById.get(assetId);
    if (!asset) return false;
    const related = relatedFor(assetId);
    return sourceMatchesAsset(asset) || related.assets.some(sourceMatchesAsset) || related.sequences.some(sourceMatchesSequence);
  };
  const renderSourceAssetTile = (assetId: string, trail: SourcePage[]) => {
    const asset = assetById.get(assetId);
    if (!asset || !sourceAssetVisible(assetId)) return null;
    const related = relatedFor(assetId);
    const count = related.assets.length + related.sequences.length;
    return <div className={styles.sourceAssetTile} key={asset.id}>
      <AssetCard asset={asset} projectId={projectId} onInfo={() => setInfoAssetId(asset.id)}
        onLocate={canvasAssetIds.has(asset.id) ? () => onLocateAsset?.(asset.id) : undefined}
        onPlace={onPlaceAsset ? () => onPlaceAsset(asset) : undefined} />
      {count > 0 && <button className={styles.sourceTileAction} type="button"
        onClick={() => setSourceTrail([...trail, { kind: "asset", category: sourceCategory(asset.sourceType), id: asset.id }])}>
        查看产物 · {count}
      </button>}
    </div>;
  };
  const sourcePageLabel = (page: SourcePage) => {
    if (page.kind === "category") return page.category === "download" ? "下载" : "导入";
    if (page.kind === "folder") return sourceView?.folders.find((item) => item.id === page.id)?.name ?? "文件夹";
    if (page.kind === "batch") return sourceView?.batches.find((item) => item.id === page.id)?.name ?? "下载批次";
    if (page.kind === "sequence") return sequenceById.get(page.id)?.name ?? "序列帧";
    return assetById.get(page.id)?.name ?? "素材";
  };
  const renderSourceCategory = (category: SourceCategory, trail: SourcePage[], home: boolean) => {
    const roots = sourceModel?.roots.filter((item) => sourceCategory(item.sourceType) === category) ?? [];
    const folders = sourceView?.folders.filter((item) => item.category === category) ?? [];
    const batches = category === "download" ? [...(sourceView?.batches ?? [])]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : [];
    const placed = new Set(sourceView?.placements.map((item) => item.assetId) ?? []);
    const content = <>
      <button className={styles.sourceCreateFolder} type="button" onClick={() => setNewFolderCategory(category)}>＋ 新建文件夹</button>
      {newFolderCategory === category && <form className={styles.sourceFolderForm} onSubmit={(event) => {
        event.preventDefault();
        void editFolder("POST", `/api/projects/${encodeURIComponent(projectId)}/asset-folders`, { name: newFolderName, sourceCategory: category });
      }}>
        <input aria-label="文件夹名称" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={80} autoFocus />
        <button type="submit">创建</button><button type="button" onClick={() => setNewFolderCategory(null)}>取消</button>
      </form>}
      <div className={styles.sourceTileGrid}>
        {folders.map((folder) => {
          const ids = roots.filter((item) => placementById.get(item.id) === folder.id && sourceAssetVisible(item.id));
          if (query && !ids.length) return null;
          const cover = assetById.get(ids[0]?.id)?.previewUrl;
          return <button className={styles.sourceFolderTile} key={folder.id} type="button"
            onClick={() => setSourceTrail([...trail, { kind: "folder", category, id: folder.id }])}>
            <span className={styles.sourceFolderCover}>{cover ? <Image alt="" fill sizes="108px" src={cover} unoptimized /> : <Icon name="folder" />}</span>
            <strong title={folder.name}>{folder.name}</strong><small>{ids.length} 项</small>
          </button>;
        })}
        {batches.map((batch) => {
          const ids = batch.assetIds.filter((id) => !placed.has(id) && firstBatchByAsset.get(id) === batch.id
            && roots.some((root) => root.id === id) && sourceAssetVisible(id));
          if (!ids.length) return null;
          const cover = assetById.get(ids[0])?.previewUrl;
          return <button className={styles.sourceFolderTile} key={batch.id} type="button"
            onClick={() => setSourceTrail([...trail, { kind: "batch", category, id: batch.id }])}>
            <span className={styles.sourceFolderCover}>{cover ? <Image alt="" fill sizes="108px" src={cover} unoptimized /> : <Icon name="folder" />}</span>
            <strong title={batch.name}>{batch.name}</strong><small>{ids.length} 项 · 下载批次</small>
          </button>;
        })}
        {roots.filter((item) => !placed.has(item.id) && !firstBatchByAsset.has(item.id))
          .map((item) => renderSourceAssetTile(item.id, trail))}
      </div>
    </>;
    return home ? <details className={styles.assetSourceSection} key={category} open>
      <summary>{category === "download" ? "下载" : "导入"} · {roots.length}</summary>{content}
    </details> : <section className={styles.assetSourceSection}>{content}</section>;
  };
  const renderSourceContent = () => {
    if (!sourceView || !sourceModel) return null;
    const page = sourceTrail.at(-1);
    if (!page) return <>{(["download", "import"] as const).map((category) =>
      renderSourceCategory(category, [{ kind: "category", category }], true))}</>;
    const breadcrumbs = <nav className={styles.sourceBreadcrumb} aria-label="资产位置">
      <button type="button" onClick={() => setSourceTrail([])}>按来源</button>
      {sourceTrail.map((item, index) => <span key={`${item.kind}:${item.kind === "category" ? item.category : item.id}`}>
        <span aria-hidden="true">›</span><button type="button" aria-current={index === sourceTrail.length - 1 ? "page" : undefined}
          onClick={() => setSourceTrail(sourceTrail.slice(0, index + 1))}>{sourcePageLabel(item)}</button>
      </span>)}
    </nav>;
    if (page.kind === "category") return <>{breadcrumbs}{renderSourceCategory(page.category, sourceTrail, false)}</>;
    if (page.kind === "folder" || page.kind === "batch") {
      const folder = page.kind === "folder" ? sourceView.folders.find((item) => item.id === page.id) : null;
      const batch = page.kind === "batch" ? sourceView.batches.find((item) => item.id === page.id) : null;
      const ids = page.kind === "folder"
        ? sourceModel.roots.filter((item) => placementById.get(item.id) === page.id).map((item) => item.id)
        : batch?.assetIds.filter((id) => !placementById.has(id) && firstBatchByAsset.get(id) === page.id
          && sourceModel.roots.some((item) => item.id === id)) ?? [];
      return <>{breadcrumbs}<div className={styles.sourcePageActions}>
        <strong>{folder?.name ?? batch?.name}</strong>
        <button type="button" onClick={() => {
          const name = window.prompt("重命名", folder?.name ?? batch?.name ?? "");
          if (!name || name === (folder?.name ?? batch?.name)) return;
          const path = folder
            ? `/api/projects/${encodeURIComponent(projectId)}/asset-folders/${encodeURIComponent(folder.id)}`
            : `/api/projects/${encodeURIComponent(projectId)}/asset-batches/${encodeURIComponent(batch!.id)}`;
          void editFolder("PATCH", path, { name });
        }}>重命名</button>
        {folder && <button type="button" onClick={() => {
          void deleteFolder(folder.id).then((deleted) => { if (deleted) setSourceTrail(sourceTrail.slice(0, -1)); });
        }}>删除文件夹</button>}
      </div><div className={styles.sourceTileGrid}>{ids.map((id) => renderSourceAssetTile(id, sourceTrail))}</div>
        {!ids.some(sourceAssetVisible) && <p className={styles.sourcePageEmpty}>这里没有匹配的素材</p>}</>;
    }
    if (page.kind === "asset") {
      const asset = assetById.get(page.id);
      if (!asset) return <>{breadcrumbs}<p className={styles.sourcePageEmpty}>素材已不在当前项目</p></>;
      const related = relatedFor(asset.id);
      const relatedAssets = related.assets.filter(sourceMatchesAsset);
      const relatedSequences = related.sequences.filter(sourceMatchesSequence);
      return <>{breadcrumbs}<h3 className={styles.sourcePageHeading}>原始素材</h3>
        <div className={styles.sourceTileGrid}><div className={styles.sourceAssetTile}>
          <AssetCard asset={asset} projectId={projectId} onInfo={() => setInfoAssetId(asset.id)}
            onLocate={canvasAssetIds.has(asset.id) ? () => onLocateAsset?.(asset.id) : undefined}
            onPlace={onPlaceAsset ? () => onPlaceAsset(asset) : undefined} />
        </div></div>
        {!["image-crop", "frame-extraction", "frame-stitch", "video-clip", "video-cutting"].includes(asset.sourceType)
          && <label className={styles.assetFolderMove}>整理到<select value={placementById.get(asset.id) ?? ""}
            onChange={(event) => void moveToFolder(asset.id, event.target.value || null)}>
            <option value="">来源原位</option>{sourceView.folders.filter((folder) => folder.category === page.category)
              .map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
        <h3 className={styles.sourcePageHeading}>相关产物 · {related.assets.length + related.sequences.length}</h3>
        {relatedAssets.length + relatedSequences.length ? <div className={styles.sourceTileGrid}>
          {relatedSequences.map((sequence) => <button className={styles.sourceFolderTile} key={sequence.id} type="button"
            draggable onDragStart={(event) => { event.dataTransfer.setData(SEQUENCE_DRAG_TYPE, JSON.stringify(sequence)); event.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => setSourceTrail([...sourceTrail, { kind: "sequence", category: page.category, id: sequence.id }])}>
            <span className={styles.sourceFolderCover}>{sequence.frames[0]?.previewUrl
              ? <Image alt="" fill sizes="108px" src={sequence.frames[0].previewUrl} unoptimized /> : <Icon name="layers" />}</span>
            <strong title={sequence.name}>{sequence.name}</strong><small>{sequence.frames.length} 帧 · 序列帧</small>
          </button>)}
          {relatedAssets.map((item) => <div className={styles.sourceAssetTile} key={item.id}>
            <AssetCard asset={item} projectId={projectId} onInfo={() => setInfoAssetId(item.id)}
              onLocate={canvasAssetIds.has(item.id) ? () => onLocateAsset?.(item.id) : undefined}
              onPlace={onPlaceAsset ? () => onPlaceAsset(item) : undefined} />
          </div>)}
        </div> : <p className={styles.sourcePageEmpty}>暂无匹配的已保存产物</p>}</>;
    }
    const sequence = sequenceById.get(page.id);
    return <>{breadcrumbs}{sequence ? <>
      <div className={styles.sourcePageActions}><strong>{sequence.name} · {sequence.frames.length} 帧</strong>
        {sequence.frames.some((frame) => canvasAssetIds.has(frame.id)) &&
          <button type="button" onClick={() => onLocateSequence?.(sequence)}>定位画布</button>}</div>
      <div className={styles.sourceTileGrid}>{sequence.frames.map((frame, index) => ({ frame, index })).filter(({ frame }) =>
        scope === "project" || (scope === "on-canvas" ? canvasAssetIds.has(frame.id) : !canvasAssetIds.has(frame.id)))
        .map(({ frame, index }) => <div className={styles.sourceAssetTile} key={`${frame.id}:${index}`}>
          <AssetCard asset={{ ...frame, name: `第 ${index + 1} 帧` }} projectId={projectId}
            onInfo={() => setInfoAssetId(frame.id)}
            onLocate={canvasAssetIds.has(frame.id) ? () => onLocateAsset?.(frame.id) : undefined}
            onPlace={onPlaceAsset ? () => onPlaceAsset(frame) : undefined} />
        </div>)}</div>
    </> : <p className={styles.sourcePageEmpty}>序列帧已不在当前项目</p>}</>;
  };

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
  }, [updateScrollThumb, visibleAssets.length, visibleSequences.length]);

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
      await refreshSourceView();
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
        <div className={styles.assetViewSettings}><button type="button" aria-label="资产分类模式" onClick={() => setViewMenuOpen((open) => !open)}><Icon name="settings" /></button>
          {viewMenuOpen && <div className={styles.assetViewMenu}><button type="button" onClick={() => { setViewMode("flat"); setSourceTrail([]); setFlatSequenceId(null); setViewMenuOpen(false); }}>平铺{viewMode === "flat" ? " ✓" : ""}</button>
            <button type="button" onClick={() => { setViewMode("source"); setSourceTrail([]); setFlatSequenceId(null); setViewMenuOpen(false); }}>按来源{viewMode === "source" ? " ✓" : ""}</button></div>}</div>
        <span>{scopedAssets.length + scopedSequences.length}</span>
      </div>
      <div className={styles.assetFilters}>
        {filters.map((item) => <button className={filter === item.value ? styles.filterActive : ""} key={item.value} onClick={() => setFilter(item.value)} type="button">{item.label}</button>)}
      </div>

      {message ? <div className={styles.assetMessage} aria-live="polite">{message}</div> : null}
      <div className={styles.assetListViewport} ref={scrollViewportRef}>
        <div className={styles.assetListScroller} data-asset-scroll-container onScroll={onAssetScroll} ref={scrollRef}>
          <div className={styles.assetListContent}>
            {pending ? <div className={styles.assetEmpty}>正在导入图片…</div> : viewMode === "source" && sourceView && sourceModel ? (
              renderSourceContent()
            ) : visibleAssets.length || visibleSequences.length ? (
              flatSequenceId && visibleSequences.some((sequence) => sequence.id === flatSequenceId) ? (() => {
                const sequence = sequenceById.get(flatSequenceId)!;
                return <><div className={styles.sourcePageActions}>
                  <button type="button" onClick={() => setFlatSequenceId(null)}>‹ 返回全部资产</button>
                  <strong>{sequence.name} · {sequence.frames.length} 帧</strong>
                  {sequence.frames.some((frame) => canvasAssetIds.has(frame.id)) &&
                    <button type="button" onClick={() => onLocateSequence?.(sequence)}>定位画布</button>}
                </div><div className={styles.assetGrid}>{sequence.frames.map((frame, index) => ({ frame, index })).filter(({ frame }) =>
                  scope === "project" || (scope === "on-canvas" ? canvasAssetIds.has(frame.id) : !canvasAssetIds.has(frame.id)))
                  .map(({ frame, index }) => <AssetCard key={`${frame.id}:${index}`} projectId={projectId}
                    asset={{ ...frame, name: `第 ${index + 1} 帧` }} onInfo={() => setInfoAssetId(frame.id)}
                    onLocate={canvasAssetIds.has(frame.id) ? () => onLocateAsset?.(frame.id) : undefined}
                    onPlace={onPlaceAsset ? () => onPlaceAsset(frame) : undefined} />)}</div></>;
              })() : <div className={styles.assetGrid}>
                {visibleAssets.map((asset) => <AssetCard asset={asset} projectId={projectId} key={asset.id}
                  onInfo={() => setInfoAssetId(asset.id)}
                  onLocate={canvasAssetIds.has(asset.id) ? () => onLocateAsset?.(asset.id) : undefined}
                  onPlace={onPlaceAsset && (asset.type === "image" || asset.type === "video") ? () => onPlaceAsset(asset) : undefined} />)}
                {visibleSequences.map((sequence) => <button className={styles.sourceFolderTile} key={sequence.id}
                  type="button" draggable onDragStart={(event) => {
                    event.dataTransfer.setData(SEQUENCE_DRAG_TYPE, JSON.stringify(sequence));
                    event.dataTransfer.effectAllowed = "copy";
                  }} onClick={() => setFlatSequenceId(sequence.id)}>
                  <span className={styles.sourceFolderCover}>{sequence.frames[0]?.previewUrl
                    ? <Image alt="" fill sizes="108px" src={sequence.frames[0].previewUrl} unoptimized /> : <Icon name="layers" />}</span>
                  <strong title={sequence.name}>{sequence.name}</strong><small>{sequence.frames.length} 帧 · 序列帧</small>
                </button>)}
              </div>
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

      {historyOpen ? <HistoryAssetDialog currentProjectId={projectId} onClose={() => setHistoryOpen(false)} onReferenced={(items) => { setAssets(items); void refreshSourceView(); }} /> : null}
      {infoAssetId && <AssetInfoDialog projectId={projectId} assetId={infoAssetId} canvasAssetIds={canvasAssetIds}
        onLocate={onLocateAsset} onClose={() => setInfoAssetId(null)} />}
    </div>
  );
}
