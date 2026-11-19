"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResolvedVideo, VideoTaskSummary } from "./types";
import styles from "./video-download.module.css";

const labels: Record<string, string> = { queued: "排队中", downloading: "下载中", merging: "合并中", verifying: "校验中", ready: "下载完成，待导入", importing: "导入中", completed: "已导入", failed: "失败", cancelled: "已取消", interrupted: "已中断，请手动重试" };
const authLabels: Record<string, string> = { checking: "正在校验登录状态…", anonymous: "未登录，可尝试公开画质", loggedIn: "已登录", waiting: "请用 B 站 App 扫码", scanned: "已扫码，请在手机确认", expired: "二维码已过期，请刷新", success: "已登录", error: "登录状态暂时无法校验" };
function size(bytes: number | null) { return bytes === null ? "大小未知" : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
async function api(path: string, method = "POST", body?: unknown) {
  const response = await fetch(path, { method, cache: "no-store", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败，请稍后重试");
  return result;
}

export function VideoDownloadModal({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/video-downloads`;
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [choice, setChoice] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const [tasks, setTasks] = useState<VideoTaskSummary[]>([]);
  const [auth, setAuth] = useState("checking");
  const [image, setImage] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [previewTask, setPreviewTask] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ availableBytes: number; processing: boolean; versions: { python: string; ytDlp: string; ffmpeg: string } } | null>(null);
  const mounted = useRef(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(async () => {
    const data = await api(base, "GET");
    if (mounted.current) setTasks(data.tasks);
  }, [base]);

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    closeRef.current?.focus();
    let polling = false;
    const read = async () => {
      if (polling) return; polling = true;
      try { await refresh(); } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "无法读取任务"); }
      finally { polling = false; }
    };
    void read();
    void api("/api/video-downloads/storage", "GET").then(value => { if (mounted.current) setStorage(value); }).catch(() => {});
    void api("/api/video-downloads/auth", "POST", { action: "status" }).then(result => { if (mounted.current) setAuth(result.status); })
      .catch(error => { if (mounted.current) { setAuth("error"); setMessage(error.message); } });
    const timer = setInterval(() => void read(), 1000);
    return () => { mounted.current = false; clearInterval(timer); if (previous instanceof HTMLElement) previous.focus(); };
  }, [refresh]);

  useEffect(() => {
    if (!["waiting", "scanned"].includes(auth)) return;
    let stopped = false, pending = false;
    const timer = setInterval(async () => {
      if (pending) return; pending = true;
      try {
        const result = await api("/api/video-downloads/auth", "POST", { action: "poll" });
        if (!stopped) { setAuth(result.status); if (["success", "expired"].includes(result.status)) setImage(null); }
      } catch (error) { if (!stopped) { setMessage(error instanceof Error ? error.message : "登录校验失败"); setAuth("error"); } }
      finally { pending = false; }
    }, 1800);
    return () => { stopped = true; clearInterval(timer); };
  }, [auth]);

  async function login(action: "generate" | "logout" | "status") {
    if (authBusy) return;
    setAuthBusy(true); setMessage("");
    try {
      const result = await api("/api/video-downloads/auth", "POST", { action });
      if (!mounted.current) return;
      setAuth(result.status); setImage(result.image ? `data:image/png;base64,${result.image}` : null);
      if (action !== "status") { setVideo(null); setChoice(""); }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "登录操作失败"); }
    finally { if (mounted.current) setAuthBusy(false); }
  }
  async function parse(input = url) {
    if (busy) return;
    setBusy(true); setMessage(""); setVideo(null); setChoice(""); setCoverFailed(false);
    try {
      const result = await api(`${base}/resolve`, "POST", { url: input });
      if (!mounted.current) return;
      const next: ResolvedVideo = result.video;
      setVideo(next); setChoice(next.choices[0]?.id ?? ""); setUrl(next.sourceUrl);
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "解析失败"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function start() {
    if (!video || busy) return;
    setBusy(true); setMessage("");
    try { await api(base, "POST", { resolveId: video.resolveId, choiceId: choice }); await refresh(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "下载失败"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function action(task: VideoTaskSummary, name: "cancel" | "retry" | "discard" | "import" | "preview" | "cleanup") {
    if (taskBusy) return;
    if (name === "discard" && !window.confirm("放弃这个待导入结果？原片不会进入素材库，之后可重新下载。")) return;
    if (name === "cleanup" && !window.confirm("清理此任务的临时下载和任务预览？已入库原片与资产预览会保留，未完成的下载将无法续下。")) return;
    setTaskBusy(task.id); setMessage("");
    try {
      await api(`${base}/${task.id}${name === "cancel" ? "" : `/${name}`}`, name === "cancel" ? "DELETE" : "POST");
      await refresh();
      if (name === "import" && mounted.current) { setMessage("已导入当前项目素材库"); onImported(); }
      if (name === "cleanup" && mounted.current) {
        if (previewTask === task.id) setPreviewTask(null);
        setMessage("临时文件已清理，已入库素材保持可用");
        void api("/api/video-downloads/storage", "GET").then(value => { if (mounted.current) setStorage(value); }).catch(() => {});
      }
    }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { if (mounted.current) setTaskBusy(null); }
  }

  return <div className={styles.overlay} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'));
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="video-download-title">
      <header><div><h2 id="video-download-title">下载视频</h2><p>B 站素材 · 当前项目</p></div><button ref={closeRef} onClick={onClose} aria-label="关闭视频下载">×</button></header>
      <div className={styles.content}>
        <div className={styles.login}><span>{authLabels[auth] ?? auth}</span><div>
          <button disabled={authBusy} onClick={() => void login("status")}>校验状态</button>
          {["loggedIn", "success"].includes(auth) ? <button disabled={authBusy} onClick={() => void login("logout")}>退出登录</button>
            : <button disabled={authBusy} onClick={() => void login("generate")}>{image ? "刷新二维码" : "扫码登录"}</button>}
        </div></div>
        {image && <div className={styles.qr}><Image src={image} width={180} height={180} alt="B 站登录二维码" unoptimized /><p>使用 B 站 App 扫码并确认</p></div>}
        <form className={styles.url} onSubmit={event => { event.preventDefault(); void parse(); }}>
          <input aria-label="B站视频链接" value={url} onChange={event => { setUrl(event.target.value); setVideo(null); }} placeholder="粘贴 B 站视频链接、BV 号或 b23.tv 短链" disabled={busy} maxLength={2000} />
          <button disabled={busy || !url.trim()} type="submit">{busy ? "处理中…" : "解析链接"}</button>
        </form>
        {message && <p className={styles.error} role="alert">{message}</p>}
        {video && <div className={styles.resolved}>
          {video.cover && !coverFailed ? <Image src={video.cover} alt="视频封面" width={200} height={114} referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} unoptimized />
            : <div className={styles.coverPlaceholder}>视频素材</div>}
          <div><h3>{video.title}</h3><p>{video.bvid} · {video.duration === null ? "时长未知" : `${Math.ceil(video.duration)} 秒`}</p>
            <label>分 P<select value={video.part} disabled={busy} onChange={event => void parse(`https://www.bilibili.com/video/${video.bvid}?p=${event.target.value}`)}>
              {video.pages.map(page => <option key={page.part} value={page.part}>P{page.part} {page.title}</option>)}
            </select></label>
            <label>画质<select value={choice} disabled={busy} onChange={event => setChoice(event.target.value)}>
              {video.choices.map(option => <option key={option.id} value={option.id}>{option.label} · {size(option.size)}</option>)}
            </select></label>
            <button className={styles.primary} disabled={busy || !choice} onClick={() => void start()}>开始下载</button>
          </div>
        </div>}
        <h3 className={styles.historyTitle}>本项目下载记录</h3>
        {!tasks.length && <p className={styles.empty}>暂无下载任务</p>}
        <div className={styles.tasks}>{tasks.map(task => {
          const canCancel = ["queued", "downloading", "merging", "verifying", "interrupted"].includes(task.status);
          const percent = task.progress.totalBytes && task.progress.downloadedBytes !== null ? Math.min(100, task.progress.downloadedBytes / task.progress.totalBytes * 100) : null;
          return <article key={task.id} className={styles.task}>
            <div className={styles.taskHeading}><strong>{task.title}</strong><span>{labels[task.status]}</span></div>
            <p>{task.bvid} · P{task.part} · {task.formatIds.join(" + ")}</p>
            {task.status === "downloading" && <><progress aria-label="当前音视频流下载进度" max={100} {...(percent === null ? {} : { value: percent })} /><p>当前音视频流：{size(task.progress.downloadedBytes)} / {size(task.progress.totalBytes)}{task.progress.speed !== null ? ` · ${size(task.progress.speed)}/s` : ""}</p></>}
            {task.recoveryMode === "continued" && <p>已续下有效的部分文件</p>}
            {task.recoveryMode === "restarted" && <p>服务器不支持本次续下，已重新下载</p>}
            {task.errorMessage && <p className={styles.error}>{task.errorMessage}</p>}
            {["ready", "completed"].includes(task.status) && <>
              {task.previewStatus === "generating" && <p>正在生成兼容预览，可先导入原片。</p>}
              {task.previewStatus === "pending" && <p>兼容预览等待处理中，可先导入原片。</p>}
              {previewTask === task.id && task.previewUrl && <video className={styles.preview} controls playsInline preload="metadata" src={task.previewUrl} poster={task.coverUrl ?? undefined}
                onError={() => setMessage("当前预览无法播放，原片仍保留；可以生成或重试兼容预览。")} aria-label={`${task.title}预览`} />}
            </>}
            <div className={styles.actions}>
              {(canCancel || task.previewStatus === "generating") && <button disabled={!!taskBusy} onClick={() => void action(task, "cancel")}>{taskBusy === task.id ? "正在停止…" : task.previewStatus === "generating" ? "停止预览" : task.status === "interrupted" ? "放弃任务" : "取消下载"}</button>}
              {["failed", "cancelled", "interrupted"].includes(task.status) && <button disabled={!!taskBusy} onClick={() => void action(task, "retry")}>重试</button>}
              {task.errorCode === "RESUME_UNVERIFIED" && <button disabled={busy} onClick={() => void parse(task.sourceUrl)}>重新解析并新建下载</button>}
              {task.previewUrl && <button onClick={() => setPreviewTask(previewTask === task.id ? null : task.id)}>{previewTask === task.id ? "收起预览" : "预览视频"}</button>}
              {["ready", "completed"].includes(task.status) && task.errorCode !== "HDR_PREVIEW_UNSUPPORTED" && !["generating", "pending"].includes(task.previewStatus) && <button disabled={!!taskBusy} onClick={() => void action(task, "preview")}>{task.previewStatus === "failed" ? "重试预览" : "生成兼容预览"}</button>}
              {task.status === "ready" && <>
                {task.previewStatus !== "generating" && <button disabled={!!taskBusy} onClick={() => void action(task, "discard")}>放弃结果</button>}
                <button className={styles.primary} disabled={!!taskBusy} onClick={() => void action(task, "import")}>{taskBusy === task.id ? "正在入库…" : "导入素材库"}</button>
              </>}
              {task.status === "completed" && <button onClick={() => { onImported(); onClose(); }}>查看素材库</button>}
              {["failed", "cancelled", "completed"].includes(task.status) && task.previewStatus !== "generating" && <button disabled={!!taskBusy} onClick={() => void action(task, "cleanup")}>清理临时文件</button>}
            </div>
          </article>;
        })}</div>
        <details className={styles.storage}><summary>存储与备份说明{storage ? ` · 可用 ${(storage.availableBytes / 1024 ** 3).toFixed(1)} GB` : ""}</summary>
          <p>下载先保留在临时区，只有点击“导入素材库”才成为正式素材。待导入的原片不会自动清除。</p>
          <p>备份前请先导入想保留的素材，停止下载和预览生成，再退出应用。备份数据目录中的 database、storage 及版本信息；临时下载不作为正式素材备份，cache 可重建。恢复后缺少临时文件的任务需重新下载。</p>
          <p>登录凭据仅供当前 Windows 用户使用，不建议随素材分享；恢复到其他账户时请重新扫码。</p>
          {storage && <p>Python {storage.versions.python} · yt-dlp {storage.versions.ytDlp} · FFmpeg {storage.versions.ffmpeg}</p>}
        </details>
      </div>
      <footer><span>关闭窗口后下载继续；退出应用会停止处理。</span><button onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}
