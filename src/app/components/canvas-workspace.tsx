"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import Link from "next/link";
import { CanvasSurface } from "@/features/canvas/canvas-surface";
import { AssetPanel } from "@/features/assets/asset-panel";
import { ImageDownloadModal } from "@/features/assets/image-download-modal";
import type { CanvasDocumentState } from "@/features/projects/types";
import { Icon, type IconName } from "./app-icon";
import styles from "../ui-shell.module.css";

type CanvasWorkspaceProps = { initialDocument: CanvasDocumentState | null; projectId: string; title: string };
type ResizeSide = "left" | "right";

const panelLimits = {
  left: { min: 180, max: 420 },
  right: { min: 240, max: 520 },
} as const;

const toolGroups: Array<{
  label: string;
  items: Array<{ icon: IconName; label: string; color: string; soft: string; expandable?: boolean }>;
}> = [
  {
    label: "内容",
    items: [
      { icon: "image", label: "图片", color: "#4f7de0", soft: "#e8efff" },
      { icon: "video", label: "视频", color: "#7b61dc", soft: "#eee9ff" },
      { icon: "text", label: "文本", color: "#258b69", soft: "#e2f6ee" },
    ],
  },
  {
    label: "处理",
    items: [
      { icon: "crop", label: "裁切", color: "#b26b24", soft: "#fff0df", expandable: true },
      { icon: "filter", label: "筛选", color: "#2a9974", soft: "#e3f6ef", expandable: true },
    ],
  },
  {
    label: "输出",
    items: [
      { icon: "download", label: "下载", color: "#4e75d6", soft: "#e8efff", expandable: true },
    ],
  },
];

export function CanvasWorkspace({ initialDocument, projectId, title }: CanvasWorkspaceProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftView, setLeftView] = useState<"tools" | "assets">("tools");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(218);
  const [rightWidth, setRightWidth] = useState(284);
  const [resizingSide, setResizingSide] = useState<ResizeSide | null>(null);
  const [canvasAssetIds, setCanvasAssetIds] = useState<ReadonlySet<string>>(() => new Set());
  const resizeRef = useRef<{
    side: ResizeSide;
    pointerId: number;
    startX: number;
    startWidth: number;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);
  const documentRef = useRef<CanvasDocumentState | null>(initialDocument);
  const lastSavedDocumentRef = useRef(initialDocument ? JSON.stringify(initialDocument) : "");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "failed">("saved");

  const persistDocument = useCallback(async (document = documentRef.current) => {
    if (!document) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const serialized = JSON.stringify(document);
    if (serialized === lastSavedDocumentRef.current) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: serialized,
      });
      if (!response.ok) throw new Error("保存失败");
      lastSavedDocumentRef.current = serialized;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    }
  }, [projectId]);

  const handleDocumentChange = useCallback((document: CanvasDocumentState) => {
    documentRef.current = document;
    const serialized = JSON.stringify(document);
    if (serialized === lastSavedDocumentRef.current) return;
    setSaveStatus("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persistDocument(document), 700);
  }, [persistDocument]);

  useEffect(() => {
    const saveBeforeLeaving = () => {
      const document = documentRef.current;
      if (!document || JSON.stringify(document) === lastSavedDocumentRef.current) return;
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", saveBeforeLeaving);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeaving);
      saveBeforeLeaving();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [projectId]);

  const clampPanelWidth = useCallback((side: ResizeSide, width: number) => {
    const limits = panelLimits[side];
    const otherWidth = side === "left" ? (rightCollapsed ? 0 : rightWidth) : (leftCollapsed ? 0 : leftWidth);
    const viewportLimit = typeof window === "undefined" ? limits.max : window.innerWidth - otherWidth - 420;
    return Math.min(Math.max(width, limits.min), Math.max(limits.min, Math.min(limits.max, viewportLimit)));
  }, [leftCollapsed, leftWidth, rightCollapsed, rightWidth]);

  const beginResize = (side: ResizeSide, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: side === "left" ? leftWidth : rightWidth,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizingSide(side);
  };

  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const delta = event.clientX - resize.startX;
    const nextWidth = clampPanelWidth(resize.side, resize.startWidth + (resize.side === "left" ? delta : -delta));
    if (resize.side === "left") setLeftWidth(nextWidth); else setRightWidth(nextWidth);
  };

  const endResize = (event: PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = resize.previousCursor;
    document.body.style.userSelect = resize.previousUserSelect;
    resizeRef.current = null;
    setResizingSide(null);
  };

  const resizeWithKeyboard = (side: ResizeSide, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const visualDirection = event.key === "ArrowRight" ? 1 : -1;
    const delta = visualDirection * (side === "left" ? 12 : -12);
    if (side === "left") setLeftWidth((width) => clampPanelWidth(side, width + delta));
    else setRightWidth((width) => clampPanelWidth(side, width + delta));
  };

  const handleCanvasAssetIdsChange = useCallback((assetIds: string[]) => {
    setCanvasAssetIds((current) => {
      if (current.size === assetIds.length && assetIds.every((id) => current.has(id))) return current;
      return new Set(assetIds);
    });
  }, []);

  const bodyClassName = [
    styles.editorBody,
    leftCollapsed ? styles.leftCollapsed : "",
    rightCollapsed ? styles.rightCollapsed : "",
    resizingSide ? styles.resizingPanels : "",
  ].filter(Boolean).join(" ");
  const bodyStyle = {
    "--left-panel-width": `${leftWidth}px`,
    "--right-panel-width": `${rightWidth}px`,
  } as CSSProperties;

  return (
    <main className={styles.editorShell}>
      <header className={styles.editorTopbar}>
        <Link className={styles.iconButton} href="/" aria-label="返回首页">
          <Icon name="arrow-left" />
        </Link>
        <div className={styles.topbarBrand}>
          <span className={`${styles.brandMark} ${styles.miniBrandMark}`} aria-hidden="true"><span /><span /><span /></span>
          <span>MOWO Canvas</span>
        </div>
        <span className={styles.topbarDivider} />
        <span className={styles.projectTitle}>{title}</span>
        <Icon className={styles.projectTitleEdit} name="text" />
        <span className={styles.topbarSpacer} />
        <button className={styles.iconButton} aria-label="撤销" type="button"><Icon name="undo" /></button>
        <button className={styles.iconButton} aria-label="重做" type="button"><Icon name="redo" /></button>
        <span className={styles.topbarDivider} />
        <span className={styles.saveState}><span className={`${styles.saveDot} ${saveStatus === "failed" ? styles.saveDotFailed : saveStatus !== "saved" ? styles.saveDotPending : ""}`} />{saveStatus === "saved" ? "已保存" : saveStatus === "saving" ? "保存中…" : saveStatus === "failed" ? "保存失败" : "未保存"}</span>
        <button className={styles.topbarPrimary} disabled={saveStatus === "saving"} onClick={() => void persistDocument()} type="button"><Icon name="save" />保存</button>
        <button className={styles.topbarAction} type="button"><Icon name="upload" />导出</button>
      </header>

      <div className={bodyClassName} style={bodyStyle}>
        <aside className={styles.toolPanel} aria-hidden={leftCollapsed}>
          <div className={styles.panelInner}>
            <div className={styles.panelHeader}>
              <div className={styles.leftViewTabs} aria-label="左侧面板">
                <button className={leftView === "tools" ? styles.leftViewTabActive : ""} onClick={() => setLeftView("tools")} type="button">功能</button>
                <button className={leftView === "assets" ? styles.leftViewTabActive : ""} onClick={() => setLeftView("assets")} type="button">资产</button>
              </div>
              <button aria-label="折叠左侧工具栏" onClick={() => setLeftCollapsed(true)} type="button"><Icon name="chevron-left" /></button>
            </div>
            {leftView === "assets" ? <AssetPanel canvasAssetIds={canvasAssetIds} projectId={projectId} /> : (
              <div className={styles.toolPanelContent}>
                <label className={styles.toolSearch}>
                  <Icon name="search" />
                  <input aria-label="搜索工具" placeholder="搜索工具" type="search" />
                </label>
                {toolGroups.map((group) => (
                  <section className={styles.toolSection} key={group.label}>
                    <span className={styles.toolSectionLabel}>{group.label}</span>
                    <div className={styles.toolGroup}>
                      {group.items.map((item) => item.label === "下载" ? (
                        <div className={styles.downloadTool} key={item.label}>
                          <button className={styles.toolItem} type="button">
                            <span className={styles.toolIcon} style={{ "--tool-color": item.color, "--tool-soft": item.soft } as CSSProperties}><Icon name={item.icon} /></span>
                            <span>{item.label}</span><Icon name="chevron-right" />
                          </button>
                          <div className={styles.downloadSubmenu}>
                            <button onClick={() => setDownloadOpen(true)} type="button"><Icon name="image" /><span>下载图片<small>链接导入与素材预览</small></span></button>
                            <button disabled type="button"><Icon name="video" /><span>下载视频<small>后续版本开放</small></span></button>
                          </div>
                        </div>
                      ) : (
                        <button className={styles.toolItem} key={item.label} type="button">
                          <span className={styles.toolIcon} style={{ "--tool-color": item.color, "--tool-soft": item.soft } as CSSProperties}><Icon name={item.icon} /></span>
                          <span>{item.label}</span>{item.expandable ? <Icon name="chevron-right" /> : null}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
          <button
            aria-label="调整左侧面板宽度"
            aria-orientation="vertical"
            aria-valuemax={panelLimits.left.max}
            aria-valuemin={panelLimits.left.min}
            aria-valuenow={Math.round(leftWidth)}
            className={`${styles.panelResizeHandle} ${styles.leftResizeHandle}`}
            onKeyDown={(event) => resizeWithKeyboard("left", event)}
            onPointerCancel={endResize}
            onPointerDown={(event) => beginResize("left", event)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            role="separator"
            type="button"
          />
        </aside>

        <section className={styles.canvasArea} aria-label="无限画布交互区域">
          <button className={`${styles.expandPanelButton} ${styles.expandLeft}`} aria-label="展开左侧工具栏" onClick={() => setLeftCollapsed(false)} type="button"><Icon name="chevron-right" /></button>
          <button className={`${styles.expandPanelButton} ${styles.expandRight}`} aria-label="展开右侧对话栏" onClick={() => setRightCollapsed(false)} type="button"><Icon name="chevron-left" /></button>
          <div className={styles.canvasHint}><span>交互画布</span> · 拖动、缩放与连线</div>
          <CanvasSurface initialDocument={initialDocument} onAssetIdsChange={handleCanvasAssetIdsChange} onDocumentChange={handleDocumentChange} />

          <nav className={styles.bottomToolbar} aria-label="常用工具">
            <button className={styles.bottomTool} type="button"><Icon name="plus" /><span>插入</span><Icon name="chevron-down" /></button>
            <button className={`${styles.bottomTool} ${styles.bottomToolAccent}`} type="button"><Icon name="crop" /><span>裁切</span></button>
            <button className={styles.bottomTool} type="button"><Icon name="sparkles" /><span>生成</span></button>
            <button className={styles.bottomTool} type="button"><Icon name="more" /><span>更多</span><Icon name="chevron-down" /></button>
          </nav>
        </section>

        <aside className={styles.chatPanel} aria-hidden={rightCollapsed}>
          <button
            aria-label="调整右侧面板宽度"
            aria-orientation="vertical"
            aria-valuemax={panelLimits.right.max}
            aria-valuemin={panelLimits.right.min}
            aria-valuenow={Math.round(rightWidth)}
            className={`${styles.panelResizeHandle} ${styles.rightResizeHandle}`}
            onKeyDown={(event) => resizeWithKeyboard("right", event)}
            onPointerCancel={endResize}
            onPointerDown={(event) => beginResize("right", event)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            role="separator"
            type="button"
          />
          <div className={styles.panelInner}>
            <div className={styles.panelHeader}>
              <h2>AI 助手</h2>
              <div>
                <button aria-label="模型设置" type="button"><Icon name="settings" /></button>
                <button aria-label="折叠右侧对话栏" onClick={() => setRightCollapsed(true)} type="button"><Icon name="chevron-right" /></button>
              </div>
            </div>
            <div className={styles.modelStatus}>
              <span className={styles.modelStatusText}><span className={styles.statusRing} />模型未配置</span>
              <button type="button">设置模型</button>
            </div>
            <div className={styles.chatEmpty}>
              <span className={styles.assistantOrb}><Icon name="sparkles" /></span>
              <strong>和 AI 一起搭建工作流</strong>
              <p>配置模型后，可在这里分析画布、提出节点建议或生成图片。</p>
            </div>
            <label className={styles.chatComposer}>
              <textarea aria-label="输入消息" disabled placeholder="输入消息" rows={2} />
              <button className={styles.sendButton} disabled aria-label="发送消息" type="button"><Icon name="upload" /></button>
            </label>
          </div>
        </aside>
      </div>
      {downloadOpen ? <ImageDownloadModal projectId={projectId} onClose={() => setDownloadOpen(false)} onImported={() => { setDownloadOpen(false); setLeftView("assets"); }} /> : null}
    </main>
  );
}
