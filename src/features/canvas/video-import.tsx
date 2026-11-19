"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetSummary } from "@/features/assets/types";
import { isLocalVideo, needsVideoEditor, VIDEO_MAX_BYTES } from "@/features/assets/video-policy";
import styles from "./video.module.css";

function readMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => { video.onloadedmetadata = video.onerror = null; clearTimeout(timer); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("读取视频超时，请确认视频能在浏览器中播放")); }, 20000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      video.onloadedmetadata = video.onerror = null;
      cleanup();
      if (!Number.isFinite(result.duration) || result.duration <= 0 || !result.width || !result.height) reject(new Error("无法读取视频时长或尺寸"));
      else resolve(result);
    };
    video.onerror = () => { video.onloadedmetadata = video.onerror = null; cleanup(); reject(new Error("当前浏览器无法读取此视频，请使用兼容的 MP4（H.264）视频")); };
    video.src = url;
  });
}
export function useVideoImport(projectId: string, notify: (message: string) => void) {
  const [pending, setPending] = useState<{ file: File; duration?: number } | null>(null);
  const [transfer, setTransfer] = useState<{ name: string; percent: number | null } | null>(null);
  const active = useRef(false);
  const transferRef = useRef<XMLHttpRequest | null>(null);
  const gateRef = useRef<HTMLDialogElement>(null);
  const chooseRef = useRef<((mode: "editor" | "canvas" | "cancel") => void) | null>(null);
  const choose = (mode: "editor" | "canvas" | "cancel") => { chooseRef.current?.(mode); chooseRef.current = null; setPending(null); };
  useEffect(() => { if ((pending || transfer) && gateRef.current && !gateRef.current.open) gateRef.current.showModal(); }, [pending, transfer]);
  const upload = useCallback(async (file: File): Promise<{ asset: AssetSummary; editor: boolean } | undefined> => {
    if (active.current) { notify("正在导入视频，请稍候再添加"); return; }
    active.current = true;
    try {
      if (!isLocalVideo(file) || !/\.(mp4|mov|m4v)$/i.test(file.name)) throw new Error("本轮支持 MP4、M4V、MOV；是否可播放还取决于视频编码");
      let duration: number | undefined;
      if (file.size <= VIDEO_MAX_BYTES) {
        notify("正在读取视频信息…");
        duration = (await readMetadata(file)).duration;
      }
      let mode: "editor" | "canvas" | "cancel" = "canvas";
      if (file.size > VIDEO_MAX_BYTES || needsVideoEditor(file.size, duration ?? 0)) {
        notify("");
        mode = await new Promise<"editor" | "canvas" | "cancel">((resolve) => {
          chooseRef.current = resolve;
          setPending({ file, duration });
        });
      }
      if (mode === "cancel") return;
      notify("正在导入视频…");
      setTransfer({ name: file.name, percent: 0 });
      const result = await new Promise<{ asset?: AssetSummary; error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        transferRef.current = xhr;
        xhr.open("POST", `/api/projects/${encodeURIComponent(projectId)}/videos?name=${encodeURIComponent(file.name)}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (event) => setTransfer({ name: file.name, percent: event.lengthComputable ? Math.round(event.loaded / event.total * 100) : null });
        xhr.onerror = () => reject(new Error("视频上传中断，请重试"));
        xhr.onabort = () => reject(new Error("已取消视频导入"));
        xhr.onload = () => {
          let payload: { asset?: AssetSummary; error?: string };
          try { payload = JSON.parse(xhr.responseText) as typeof payload; }
          catch { reject(new Error("视频导入返回了无效响应")); return; }
          if (xhr.status < 200 || xhr.status >= 300) reject(new Error(payload.error ?? "视频导入失败"));
          else resolve(payload);
        };
        xhr.send(file);
      });
      if (!result.asset) throw new Error("导入视频失败");
      notify("");
      return { asset: result.asset, editor: mode === "editor" };
    } catch (error) { notify(error instanceof Error ? error.message : "导入视频失败"); }
    finally { transferRef.current = null; setTransfer(null); active.current = false; }
  }, [notify, projectId]);
  const dialog = pending || transfer ? createPortal(<dialog ref={gateRef} role="dialog" className={styles.gate} onKeyDown={(event) => event.stopPropagation()} aria-labelledby="video-gate-title" onCancel={(event) => { event.preventDefault(); if (transfer) transferRef.current?.abort(); else choose("cancel"); }}>
    {transfer ? <><h2 id="video-gate-title">正在接收视频</h2><p className={styles.fileName}>{transfer.name}</p>
      <progress max={100} value={transfer.percent ?? undefined} aria-label="上传进度" />
      <p>{transfer.percent === null ? "正在上传…" : `${transfer.percent}% · 上传完成后仍需校验并入库`}</p>
      <footer><button type="button" onClick={() => transferRef.current?.abort()}>取消导入</button></footer></> : pending ? <>
    <h2 id="video-gate-title">此视频较大</h2>
    <p className={styles.fileName}>{pending.file.name}</p>
    <p>{(pending.file.size / 1024 / 1024).toFixed(1)} MiB{pending.duration !== undefined ? ` · ${Math.ceil(pending.duration)} 秒` : ""}</p>
    <p>可以先入库后进入视频观察页，也可以直接放到画布。两种选择都会保存同一份原片。</p>
    <footer><button type="button" onClick={() => choose("cancel")}>取消导入</button>
      <button type="button" onClick={() => choose("canvas")}>仍放到画布</button>
      <button autoFocus type="button" onClick={() => choose("editor")}>进入视频编辑</button></footer></> : null}
  </dialog>, document.body) : null;
  return { upload, dialog };
}
