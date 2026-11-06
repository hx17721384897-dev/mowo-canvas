"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { Icon } from "@/app/components/app-icon";
import { createBrowserSession, runErrorText, type ChatSession, type ChatState } from "./client/chat-session";
import { isTerminal, type StoredChatMessage } from "./types";
import styles from "./chat.module.css";

const SessionContext = createContext<{ state: ChatState; session: ChatSession } | null>(null);
const statusText: Record<string, string> = { queued: "等待生成", running: "正在回复", stopped: "已停止", interrupted: "生成已中断", failed: "生成失败" };
function convertMessage(message: StoredChatMessage): ThreadMessageLike {
  return { id: message.id, role: message.role, content: message.content, createdAt: new Date(message.createdAt),
    ...(message.role === "assistant" ? { status: message.status === "completed" ? { type: "complete" as const, reason: "stop" as const }
      : message.status === "queued" || message.status === "running" ? { type: "running" as const }
      : { type: "incomplete" as const, reason: message.status === "stopped" ? "cancelled" as const : "error" as const } } : {}),
  };
}
function ChatBubble() {
  const id = useAuiState((state) => state.message.id);
  const context = useContext(SessionContext)!;
  const message = context.state.messages.find((item) => item.id === id);
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  if (!message) return null;
  const { state, session } = context;
  const canRetry = message.role === "assistant" && ["failed", "stopped", "interrupted"].includes(message.status);
  const busy = state.submitting || Boolean(state.pending) || Boolean(state.activeRun && !isTerminal(state.activeRun.status));
  const source = state.messages.find((item) => item.runId === message.runId && item.role === "user");
  return <MessagePrimitive.Root className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}>
    <div className={styles.messageLabel}>{message.role === "user" ? "你" : "DeepSeek"}</div>
    <div className={styles.messageContent}>
      {message.content ? <MessagePrimitive.Parts /> : <span className={styles.muted}>{statusText[message.status] ?? "暂无回复"}…</span>}
    </div>
    {message.role === "assistant" && message.status !== "completed" && <div className={styles.messageStatus} role="status">
      {statusText[message.status]}{message.errorCode ? ` · ${runErrorText[message.errorCode] ?? "请稍后再试。"}` : ""}
    </div>}
    <div className={styles.messageActions}>
      {message.content && <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(message.content); setCopied(message.content); setCopyFailed(false); }
        catch { setCopyFailed(true); }
      }}>{copyFailed ? "复制失败，请手动选择" : copied === message.content ? "已复制" : "复制"}</button>}
      {canRetry && source && <button type="button" disabled={busy} title="使用新请求重新生成，可能产生 API 费用" onClick={() => { void session.send(source.content); }}>重新生成</button>}
    </div>
  </MessagePrimitive.Root>;
}

export function ChatPanel({ projectId, onCollapse }: { projectId: string; onCollapse: () => void }) {
  const [session] = useState(() => createBrowserSession(projectId));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    session.start();
    const focus = () => { void session.refresh(); };
    window.addEventListener("focus", focus);
    return () => { window.removeEventListener("focus", focus); session.dispose(); };
  }, [session]);
  useEffect(() => { if (settingsOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [settingsOpen]);
  const running = Boolean(state.activeRun && !isTerminal(state.activeRun.status));
  const disabled = state.loading || !state.historyReady || state.submitting || running || Boolean(state.pending) || !state.configuration?.configured;
  const runtime = useExternalStoreRuntime({
    messages: state.messages, convertMessage, isRunning: running, isLoading: state.loading,
    isSendDisabled: disabled,
    onNew: async (message) => { await session.send(message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")); },
    onCancel: () => session.stop(),
  });
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (disabled || !draft.trim()) return;
    const text = draft;
    if (await session.send(text)) setDraft((current) => current === text ? "" : current);
  }
  return <SessionContext.Provider value={{ state, session }}><AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className={styles.panel} onKeyDown={(event) => event.stopPropagation()}>
      <header className={styles.header}><h2>AI 助手</h2><div>
        <button aria-label="语言模型设置" title="语言模型设置" type="button" onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button>
        <button aria-label="折叠右侧对话栏" title="折叠对话栏" type="button" onClick={onCollapse}><Icon name="chevron-right" /></button>
      </div></header>
      <div className={styles.model}><span className={state.configuration?.configured ? styles.ready : styles.unconfigured} />
        <span>DeepSeek Flash</span><small>{state.configuration === null ? "检测配置中" : state.configuration.configured ? "已配置" : "未配置"}</small>
      </div>
      <details className={styles.contextNote}><summary>对话范围与上下文</summary><p>当前只发送文字，画布素材不会自动外发。历史按最近完整成功的问答对截取，最多 40 轮、累计 16000 字符；中断回复保留在本地记录中，不自动发送。</p></details>
      <ThreadPrimitive.Viewport className={styles.viewport}>
        {state.loading && <p className={styles.loading} role="status">正在恢复对话…</p>}
        {!state.loading && state.messages.length === 0 && <div className={styles.empty}><span><Icon name="sparkles" /></span><strong>从一句话开始</strong><p>讨论想法、整理思路。对话记录保存在当前画布。</p></div>}
        <ThreadPrimitive.Messages components={{ Message: ChatBubble }} />
      </ThreadPrimitive.Viewport>
      {state.pending && <div className={styles.notice}><strong>待核对的发送</strong><p className={styles.pendingText}>{state.pending.message}</p><button type="button" disabled={state.submitting || state.loading} onClick={() => { void session.resolvePending(true); }}>{state.submitting ? "核对中…" : "核对并重试"}</button></div>}
      {state.error && <div className={styles.notice} role="alert">{state.error}<button type="button" disabled={state.loading || state.submitting} onClick={() => { void session.refresh(); }}>恢复记录</button></div>}
      {running && <div className={styles.runStatus} role="status">{state.connection === "reconnecting" ? "连接中断，正在核对后台状态…" : state.stopping ? "正在确认停止…" : "正在生成回复…"}</div>}
      <form className={styles.composer} onSubmit={(event) => { void submit(event); }}>
        <textarea aria-label="输入消息" placeholder={state.configuration?.configured ? "输入消息，Enter 发送" : "请先配置语言模型"} rows={3} maxLength={8000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void submit(); }
        }} />
        <div className={styles.composerFooter}><span>Shift + Enter 换行</span>{running
          ? <button type="button" className={styles.stop} disabled={state.stopping} onClick={() => { void session.stop(); }}>{state.stopping ? "停止中…" : "停止"}</button>
          : <button type="submit" disabled={disabled || !draft.trim()}>{state.submitting ? "发送中…" : "发送"}</button>}</div>
      </form>
      <small className={styles.cost}>发送与重新生成按供应商 API 计费</small>
      <dialog ref={dialog} className={styles.settings} aria-labelledby="language-model-title" onCancel={() => setSettingsOpen(false)} onClose={() => setSettingsOpen(false)}>
        <h3 id="language-model-title">语言模型</h3><p>供应商：DeepSeek</p><p>当前模型：deepseek-flash</p><p>本机配置：{state.configuration?.configured ? "已检测到密钥" : "尚未检测到密钥"}</p>
        <p className={styles.muted}>当前读取本机 .env.local 中的 DEEPSEEK_API_KEY，修改后需重启本机服务。密钥不会显示在此窗口。配置检测不发起付费请求，也不代表密钥已通过鉴权。</p>
        <p className={styles.muted}>模型切换和安全保存密钥的设置界面将在下一步完善。</p>
        <div><button type="button" onClick={() => { void session.refreshConfiguration(); }}>重新检测配置</button><button type="button" onClick={() => setSettingsOpen(false)}>关闭</button></div>
      </dialog>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider></SessionContext.Provider>;
}
