"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import Link from "next/link";
import { CanvasSurface } from "@/features/canvas/canvas-surface";
import { AssetPanel } from "@/features/assets/asset-panel";
import { ImageDownloadModal } from "@/features/assets/image-download-modal";
import { Icon, type IconName } from "./app-icon";
import styles from "../ui-shell.module.css";

type CanvasWorkspaceProps = { projectId: string; title: string };

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

export function CanvasWorkspace({ projectId, title }: CanvasWorkspaceProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftView, setLeftView] = useState<"tools" | "assets">("tools");
  const [downloadOpen, setDownloadOpen] = useState(false);

  const bodyClassName = [
    styles.editorBody,
    leftCollapsed ? styles.leftCollapsed : "",
    rightCollapsed ? styles.rightCollapsed : "",
  ].filter(Boolean).join(" ");

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
        <span className={styles.saveState}><span className={styles.saveDot} />已保存</span>
        <button className={styles.topbarPrimary} type="button"><Icon name="save" />保存</button>
        <button className={styles.topbarAction} type="button"><Icon name="upload" />导出</button>
      </header>

      <div className={bodyClassName}>
        <aside className={styles.toolPanel} aria-hidden={leftCollapsed}>
          <div className={styles.panelInner}>
            <div className={styles.panelHeader}>
              <div className={styles.leftViewTabs} aria-label="左侧面板">
                <button className={leftView === "tools" ? styles.leftViewTabActive : ""} onClick={() => setLeftView("tools")} type="button">功能</button>
                <button className={leftView === "assets" ? styles.leftViewTabActive : ""} onClick={() => setLeftView("assets")} type="button">资产</button>
              </div>
              <button aria-label="折叠左侧工具栏" onClick={() => setLeftCollapsed(true)} type="button"><Icon name="chevron-left" /></button>
            </div>
            {leftView === "assets" ? <AssetPanel projectId={projectId} /> : (
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
        </aside>

        <section className={styles.canvasArea} aria-label="无限画布交互区域">
          <button className={`${styles.expandPanelButton} ${styles.expandLeft}`} aria-label="展开左侧工具栏" onClick={() => setLeftCollapsed(false)} type="button"><Icon name="chevron-right" /></button>
          <button className={`${styles.expandPanelButton} ${styles.expandRight}`} aria-label="展开右侧对话栏" onClick={() => setRightCollapsed(false)} type="button"><Icon name="chevron-left" /></button>
          <div className={styles.canvasHint}><span>交互画布</span> · 拖动、缩放与连线</div>
          <CanvasSurface />

          <nav className={styles.bottomToolbar} aria-label="常用工具">
            <button className={styles.bottomTool} type="button"><Icon name="plus" /><span>插入</span><Icon name="chevron-down" /></button>
            <button className={`${styles.bottomTool} ${styles.bottomToolAccent}`} type="button"><Icon name="crop" /><span>裁切</span></button>
            <button className={styles.bottomTool} type="button"><Icon name="sparkles" /><span>生成</span></button>
            <button className={styles.bottomTool} type="button"><Icon name="more" /><span>更多</span><Icon name="chevron-down" /></button>
          </nav>
        </section>

        <aside className={styles.chatPanel} aria-hidden={rightCollapsed}>
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
      {downloadOpen ? <ImageDownloadModal onClose={() => setDownloadOpen(false)} /> : null}
    </main>
  );
}
