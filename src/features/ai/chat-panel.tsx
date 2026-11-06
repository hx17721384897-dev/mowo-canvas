"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { Icon } from "@/app/components/app-icon";
import { createBrowserSession, runErrorText, type ChatSession, type ChatState } from "./client/chat-session";
import { isTerminal, type ConversationSummary, type StoredChatMessage } from "./types";
import { ChatIcon } from "./chat-icons";
import { ClarificationPreview } from "./clarification-preview";
import { ChatComposer } from "./chat-composer";
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
    <div className={styles.messageContent}>
      {message.content ? <MessagePrimitive.Parts /> : <span className={styles.muted}>{statusText[message.status] ?? "暂无回复"}…</span>}
    </div>
    {message.role === "assistant" && message.status !== "completed" && <div className={styles.messageStatus} role="status">
      {statusText[message.status]}{message.errorCode ? ` · ${runErrorText[message.errorCode] ?? "请稍后再试。"}` : ""}
    </div>}
    <div className={styles.messageActions}>
      <time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
      {message.content && <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(message.content); setCopied(message.content); setCopyFailed(false); }
        catch { setCopyFailed(true); }
      }}>{copyFailed ? "复制失败，请手动选择" : copied === message.content ? "已复制" : "复制"}</button>}
      {canRetry && source && <button type="button" disabled={busy} title="使用新请求重新生成，可能产生 API 费用" onClick={() => { void session.send(source.content); }}>重新生成</button>}
    </div>
  </MessagePrimitive.Root>;
}

type PanelProps = { projectId: string; onCollapse: () => void; expanded?: boolean; onExpand?: () => void };
type ConversationProps = PanelProps & {
  conversation?: ConversationSummary; conversations: ConversationSummary[]; creating: boolean;
  onNew: () => void; onSelect: (id: string) => void; onRename: (id: string | undefined, title: string) => Promise<boolean>; onActivity: () => void;
};

async function conversationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "无法读取会话，请稍后重试。");
  return data as T;
}

export function ChatPanel(props: PanelProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const lock = useRef(false);
  const loadGeneration = useRef(0);
  const invalidateLoads = useCallback(() => { ++loadGeneration.current; }, []);
  const url = `/api/projects/${encodeURIComponent(props.projectId)}/ai/conversations`;
  const selectionKey = `mowo:ai:selected:${props.projectId}`;
  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const { conversations: rows } = await conversationRequest<{ conversations: ConversationSummary[] }>(url);
      if (generation !== loadGeneration.current) return;
      setConversations(rows); setError(null);
      setSelected((current) => {
        let stored: string | null = null;
        try { stored = localStorage.getItem(selectionKey); } catch {}
        return rows.find((row) => row.id === current)?.id ?? rows.find((row) => row.id === stored)?.id ?? rows[0]?.id;
      });
      setReady(true);
    } catch (error) { if (generation === loadGeneration.current) setError(error instanceof Error ? error.message : "无法恢复会话列表。"); }
  }, [url, selectionKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => { window.clearTimeout(timer); invalidateLoads(); };
  }, [refresh, invalidateLoads]);
  useEffect(() => {
    if (!selected) return;
    try { localStorage.setItem(selectionKey, selected); } catch {}
  }, [selected, selectionKey]);
  async function newConversation() {
    if (lock.current) return;
    lock.current = true; ++loadGeneration.current; setCreating(true);
    try {
      const { conversation } = await conversationRequest<{ conversation: ConversationSummary }>(url, { method: "POST" });
      setConversations((rows) => [conversation, ...rows.filter((row) => row.id !== conversation.id)]);
      setSelected(conversation.id); setError(null);
    } catch (error) { setError(error instanceof Error ? error.message : "无法新建会话。"); }
    finally { lock.current = false; setCreating(false); }
  }
  async function rename(id: string | undefined, title: string) {
    ++loadGeneration.current;
    try {
      const target = id ?? (await conversationRequest<{ conversation: ConversationSummary }>(url, { method: "POST" })).conversation.id;
      const { conversation } = await conversationRequest<{ conversation: ConversationSummary }>(`${url}/${encodeURIComponent(target)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
      });
      setConversations((rows) => [conversation, ...rows.filter((row) => row.id !== target)]);
      if (!id) setSelected(target);
      setError(null); return true;
    } catch (error) { setError(error instanceof Error ? error.message : "无法重命名会话。"); return false; }
  }
  if (!ready) return <div className={styles.panel}><p className={styles.loading} role="status">{error ?? "正在恢复会话…"}</p>{error && <button type="button" onClick={() => { void refresh(); }}>重试</button>}</div>;
  const conversation = conversations.find((row) => row.id === selected);
  return <div className={styles.panelContainer}>
    {error && <div className={styles.notice} role="alert">{error}</div>}
    <ConversationPanel key={selected ?? "default"} {...props} conversation={conversation} conversations={conversations} creating={creating}
      onNew={() => { void newConversation(); }} onSelect={setSelected} onRename={rename} onActivity={refresh} />
  </div>;
}

function TitleInput({ title, label, onSave, onDone }: { title: string; label: string; onSave: (value: string) => Promise<boolean>; onDone: () => void }) {
  const [value, setValue] = useState(title);
  const saving = useRef(false), cancelled = useRef(false);
  async function save() {
    if (cancelled.current || saving.current) return;
    if (!value.trim() || value.trim() === title) { onDone(); return; }
    saving.current = true;
    try { if (await onSave(value)) onDone(); }
    finally { saving.current = false; }
  }
  return <input className={styles.titleInput} aria-label={label} autoFocus maxLength={80} value={value}
    onFocus={(event) => event.target.select()} onChange={(event) => setValue(event.target.value)} onBlur={() => { void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { cancelled.current = true; event.preventDefault(); onDone(); }
    }} />;
}

function ConversationPanel({ projectId, onCollapse, expanded, onExpand, conversation, conversations, creating, onNew, onSelect, onRename, onActivity }: ConversationProps) {
  const [session] = useState(() => createBrowserSession(projectId, conversation?.id));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [questionPreviewOpen, setQuestionPreviewOpen] = useState(false);
  const [menu, setMenu] = useState<"history" | "settings" | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingHistory, setEditingHistory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const header = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    session.start();
    const focus = () => { void session.refresh(); };
    window.addEventListener("focus", focus);
    return () => { window.removeEventListener("focus", focus); session.dispose(); };
  }, [session]);
  const firstMessageId = state.messages[0]?.id;
  useEffect(() => { if (firstMessageId && !state.submitting) onActivity(); }, [firstMessageId, state.submitting, onActivity]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  useEffect(() => { if (settingsOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [settingsOpen]);
  const running = Boolean(state.activeRun && !isTerminal(state.activeRun.status));
  const disabled = state.loading || !state.historyReady || state.submitting || running || Boolean(state.pending) || !state.configuration?.configured;
  const runtime = useExternalStoreRuntime({
    messages: state.messages, convertMessage, isRunning: running, isLoading: state.loading,
    isSendDisabled: disabled,
    onNew: async (message) => { await session.send(message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")); },
    onCancel: () => session.stop(),
  });
  async function submit() {
    if (disabled || !draft.trim()) return;
    const text = draft;
    if (await session.send(text)) setDraft((current) => current === text ? "" : current);
  }
  return <SessionContext.Provider value={{ state, session }}><AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className={styles.panel} onKeyDown={(event) => event.stopPropagation()}>
      <header ref={header} className={styles.header} onKeyDown={(event) => { if (event.key === "Escape") setMenu(null); }}>
        <button className={styles.logo} aria-label="会话设置菜单" aria-expanded={menu === "settings"} title="会话设置" type="button" onClick={() => setMenu(menu === "settings" ? null : "settings")}><ChatIcon name="logo" /></button>
        <div className={styles.titleArea}>{editingTitle
          ? <TitleInput title={conversation?.title ?? "新会话"} label="会话名称" onSave={(title) => onRename(conversation?.id, title)} onDone={() => setEditingTitle(false)} />
          : <button className={styles.conversationTitle} type="button" title={conversation?.title ?? "点击修改会话名称"} aria-label="修改会话名称" onClick={() => setEditingTitle(true)}>{conversation?.title ?? "新会话"}</button>}</div>
        <div className={styles.headerActions}>
          <button aria-label="新建会话" title="新建会话" type="button" disabled={creating || state.submitting} onClick={onNew}><ChatIcon name="new" /></button>
          <button aria-label="历史会话" title="当前画布的历史会话" aria-expanded={menu === "history"} type="button" onClick={() => { setMenu(menu === "history" ? null : "history"); onActivity(); }}><ChatIcon name="history" /></button>
          <button aria-label={expanded ? "还原对话区" : "放大对话区"} title={expanded ? "还原对话区" : "放大对话区"} type="button" onClick={onExpand}><ChatIcon name={expanded ? "restore" : "expand"} /></button>
          <button aria-label="折叠右侧对话栏" title="折叠对话栏" type="button" onClick={onCollapse}><ChatIcon name="collapse" /></button>
        </div>
        {menu === "history" && <div className={styles.historyMenu} aria-label="当前画布的历史会话">
          <input className={styles.historySearch} aria-label="搜索历史会话" placeholder="搜索当前画布的会话" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
          <div className={styles.historyList}>{conversations.filter((row) => row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((row) => <div className={`${styles.historyRow} ${row.id === conversation?.id ? styles.historySelected : ""}`} key={row.id}>
            {editingHistory === row.id ? <TitleInput title={row.title} label="历史会话名称" onSave={(title) => onRename(row.id, title)} onDone={() => setEditingHistory(null)} />
              : <><button className={styles.historyName} type="button" onClick={() => { setMenu(null); onSelect(row.id); }}><span>{row.title}</span><small>{new Date(row.updatedAt).toLocaleDateString("zh-CN")}</small></button>
                <button className={styles.renameHistory} aria-label={`重命名 ${row.title}`} title="重命名" type="button" onClick={() => setEditingHistory(row.id)}><ChatIcon name="rename" /></button></>}
          </div>)}{!conversations.some((row) => row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <p className={styles.historyEmpty}>没有匹配的会话</p>}</div>
        </div>}
        {menu === "settings" && <div className={styles.settingsMenu}>
          <button type="button" aria-label="语言模型设置" onClick={() => { setMenu(null); setSettingsOpen(true); }}><ChatIcon name="settings" /><span>语言模型设置</span></button>
          <button type="button" aria-label="提问卡片样式预览" onClick={() => { setMenu(null); setQuestionPreviewOpen(true); }}><Icon name="help" /><span>提问卡片样式预览</span></button>
          <div className={styles.menuModel}><span className={state.configuration?.configured ? styles.ready : styles.unconfigured} />DeepSeek Flash · {state.configuration?.configured ? "已配置" : "未配置"}</div>
          <details className={styles.contextNote}><summary>对话范围与上下文</summary><p>当前只发送文字，画布素材不会自动外发。只使用当前会话最近完整成功的问答，最多 40 轮、累计 16000 字符；中断回复不会自动发送。</p></details>
        </div>}
      </header>
      <ThreadPrimitive.Viewport className={styles.viewport}>
        {state.loading && <p className={styles.loading} role="status">正在恢复对话…</p>}
        {!state.loading && state.messages.length === 0 && <div className={styles.empty}><span><Icon name="sparkles" /></span><strong>从一句话开始</strong><p>讨论想法、整理思路。对话记录保存在当前画布。</p></div>}
        <ThreadPrimitive.Messages components={{ Message: ChatBubble }} />
      </ThreadPrimitive.Viewport>
      {state.pending && <div className={styles.notice}><strong>待核对的发送</strong><p className={styles.pendingText}>{state.pending.message}</p><button type="button" disabled={state.submitting || state.loading} onClick={() => { void session.resolvePending(true); }}>{state.submitting ? "核对中…" : "核对并重试"}</button></div>}
      {state.error && <div className={styles.notice} role="alert">{state.error}<button type="button" disabled={state.loading || state.submitting} onClick={() => { void session.refresh(); }}>恢复记录</button></div>}
      {running && <div className={styles.runStatus} role="status">{state.connection === "reconnecting" ? "连接中断，正在核对后台状态…" : state.stopping ? "正在确认停止…" : "正在生成回复…"}</div>}
      {questionPreviewOpen && <ClarificationPreview onClose={() => setQuestionPreviewOpen(false)} />}
      <ChatComposer value={draft} onChange={setDraft} onSend={() => { void submit(); }} disabled={disabled} configured={Boolean(state.configuration?.configured)}
        running={running} stopping={state.stopping} submitting={state.submitting} onStop={() => { void session.stop(); }} onSettings={() => setSettingsOpen(true)} />
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
