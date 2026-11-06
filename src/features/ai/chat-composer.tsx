"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./chat-composer.module.css";

function ComposerIcon({ name }: { name: "plus" | "file" | "mode" | "cube" | "send" | "stop" | "image" | "video" }) {
  const paths = {
    plus: <path d="M12 4v16M4 12h16" />,
    file: <><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8" /></>,
    mode: <><path d="M5 19H3v-8a8 8 0 1 1 8 8H5Z" /><path d="M8 10h.01M16 10h.01M9 14h6" /></>,
    cube: <><path d="m12 3 9 5v9l-9 5-9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v9" /></>,
    send: <path d="M12 20V5m-6 6 6-6 6 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
    image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8" cy="9" r="1" /><path d="m4 18 6-6 4 4 3-3 4 4" /></>,
    video: <><rect x="3" y="6" width="13" height="12" rx="3" /><path d="m16 10 5-3v10l-5-3Z" /></>,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const fileSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export function ChatComposer({ value, onChange, onSend, disabled, configured, running, stopping, submitting, onStop, onSettings }: {
  value: string; onChange: (value: string) => void; onSend: () => void; disabled: boolean; configured: boolean;
  running: boolean; stopping: boolean; submitting: boolean; onStop: () => void; onSettings: () => void;
}) {
  const [menu, setMenu] = useState<"tools" | "mode" | "model" | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const root = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canSend = !running && !submitting && !disabled && !files.length && Boolean(value.trim());
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const toggle = (target: typeof menu) => setMenu((current) => current === target ? null : target);
  return <form className={styles.composer} ref={root} aria-label="对话输入区" onSubmit={(event) => { event.preventDefault(); if (canSend) onSend(); }}
    onKeyDown={(event) => { if (event.key === "Escape") setMenu(null); }}>
    <input ref={picker} type="file" aria-label="选择上传文件" hidden multiple onChange={(event) => {
      const chosen = Array.from(event.target.files ?? []);
      setFiles((current) => {
        const keys = new Set(current.map(fileKey));
        return [...current, ...chosen.filter((file) => { const key = fileKey(file); if (keys.has(key)) return false; keys.add(key); return true; })];
      });
      event.target.value = "";
    }} />
    {files.length > 0 && <div className={styles.attachments} aria-label="本地文件预览">{files.map((file) => <div className={styles.attachment} key={fileKey(file)}>
      <ComposerIcon name="file" /><span title={file.name}>{file.name}<small>{fileSize(file.size)} · 本地预览</small></span>
      <button aria-label={`移除文件 ${file.name}`} title="移除文件" type="button" onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}>×</button>
    </div>)}</div>}
    {files.length > 0 && <p className={styles.fileNotice} role="status">文件暂不随消息发送，移除后可继续文字对话。</p>}
    <textarea aria-label="输入消息" placeholder={configured ? "描述你的想法…" : "请先配置语言模型"} rows={3} maxLength={8000} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) onSend(); }
    }} />
    <div className={styles.toolbar}>
      <div className={styles.left}>
        <button className={`${styles.iconButton} ${menu === "tools" ? styles.active : ""}`} type="button" aria-label="添加功能" title="添加" aria-expanded={menu === "tools"} onClick={() => toggle("tools")}><ComposerIcon name="plus" /></button>
        <button className={`${styles.modeButton} ${menu === "mode" ? styles.active : ""}`} type="button" aria-label="选择模式" title="选择模式" aria-expanded={menu === "mode"} onClick={() => toggle("mode")}><ComposerIcon name="mode" /><span>对话</span><span className={styles.chevron}>⌄</span></button>
      </div>
      <div className={styles.right}>
        <button className={`${styles.iconButton} ${menu === "model" ? styles.active : ""}`} type="button" aria-label="模型偏好" title="模型偏好" aria-expanded={menu === "model"} onClick={() => toggle("model")}><ComposerIcon name="cube" /></button>
        {running ? <button className={styles.send} type="button" aria-label="停止生成" title={stopping ? "停止中…" : "停止生成"} disabled={stopping} onClick={onStop}><ComposerIcon name="stop" /></button>
          : <button className={styles.send} type="submit" aria-label="发送消息" title={submitting ? "发送中…" : files.length ? "文件仅作本地预览，请先移除" : "发送消息（Enter）"} disabled={!canSend}><ComposerIcon name="send" /></button>}
      </div>
    </div>
    {menu === "tools" && <div className={styles.popup} role="menu" aria-label="功能菜单">
      <button type="button" role="menuitem" onClick={() => { setMenu(null); picker.current?.click(); }}><ComposerIcon name="file" /><span>上传文件<small>本地选择预览，尚未接入发送</small></span></button>
    </div>}
    {menu === "mode" && <div className={styles.popup} role="menu" aria-label="模式菜单">
      <button type="button" role="menuitemradio" aria-checked="true" onClick={() => setMenu(null)}><ComposerIcon name="mode" /><span>对话<small>文字交流与需求讨论</small></span><span className={styles.check}>✓</span></button>
      <div className={styles.divider} />
      <button type="button" role="menuitemradio" aria-checked="false" disabled><ComposerIcon name="image" /><span>图像</span><small>未接入</small></button>
      <button type="button" role="menuitemradio" aria-checked="false" disabled><ComposerIcon name="video" /><span>视频</span><small>未接入</small></button>
    </div>}
    {menu === "model" && <section className={`${styles.popup} ${styles.models}`} aria-label="模型偏好面板">
      <header><strong>模型偏好</strong><label title="接入更多模型后开放"><span>自动</span><input type="checkbox" role="switch" aria-label="自动选择模型" disabled /></label></header>
      <div className={styles.tabs} role="tablist" aria-label="模型类型"><button type="button" role="tab" aria-selected="true">语言</button><button type="button" role="tab" aria-selected="false" disabled title="图像模型未接入">图像</button><button type="button" role="tab" aria-selected="false" disabled title="视频模型未接入">视频</button></div>
      <div className={styles.modelRow}><ComposerIcon name="mode" /><div><strong>DeepSeek Flash</strong><small>当前文字对话模型 · {configured ? "已配置" : "未配置"}</small></div><span className={styles.check}>✓</span></div>
      <p>自动选择与其他模型将在接入后开放。</p>
      <button className={styles.manage} type="button" onClick={() => { setMenu(null); onSettings(); }}>管理模型配置</button>
    </section>}
  </form>;
}
