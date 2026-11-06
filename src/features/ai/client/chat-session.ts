import { isTerminal, type AiConfiguration, type AiRun, type ConversationSnapshot, type StoredChatMessage } from "../types.ts";

type PendingRequest = { clientRequestId: string; message: string };
export type ChatState = {
  messages: StoredChatMessage[]; activeRun: AiRun | null; configuration: AiConfiguration | null;
  loading: boolean; historyReady: boolean; submitting: boolean; stopping: boolean; pending: PendingRequest | null;
  error: string | null; connection: "connected" | "reconnecting";
};
type Stream = Pick<EventSource, "close" | "onmessage" | "onerror">;
type Dependencies = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  readPending: () => PendingRequest | null;
  writePending: (value: PendingRequest | null) => void;
  stream: (path: string) => Stream;
  uuid: () => string;
};
export class ChatRequestError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const initial: ChatState = { messages: [], activeRun: null, configuration: null, loading: true, historyReady: false,
  submitting: false, stopping: false, pending: null, error: null, connection: "connected" };
export const runErrorText: Record<string, string> = {
  CONFIG_MISSING: "尚未配置本机 API Key。", PROVIDER_AUTH: "密钥无效，请检查本机配置。",
  PROVIDER_BALANCE: "API 余额不足，请在 DeepSeek 平台查看余额。", PROVIDER_LIMIT: "供应商请求受限，请稍后再试。",
  PROVIDER_INPUT: "供应商未接受本次输入，请调整消息。", PROVIDER_ERROR: "模型请求未完成，请检查网络或稍后重试。",
  RUN_TIMEOUT: "生成超时，已保留收到的内容。", WORKER_LOST: "后台执行中断，已保留收到的内容。",
  WORKER_START_FAILED: "后台执行未能启动，请检查本机服务。",
};

// Owns only dialogue state. No canvas writes, API keys, or provider calls in the browser.
export class ChatSession {
  private state: ChatState = initial;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private enabled = false;
  private stream: Stream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private projectUrl: string;
  private dependencies: Dependencies;
  private conversationId: string | undefined;
  constructor(projectId: string, dependencies: Dependencies, conversationId?: string) {
    this.conversationId = conversationId;
    this.projectUrl = `/api/projects/${encodeURIComponent(projectId)}/ai/runs${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`;
    this.dependencies = dependencies;
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => initial;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private live(epoch: number) { return this.enabled && this.epoch === epoch; }
  private remember(pending: PendingRequest | null) {
    this.dependencies.writePending(pending); // Persist before POST; failed storage must prevent sending.
    this.update({ pending });
  }
  private error(error: unknown) { return error instanceof Error ? error.message : "对话连接失败，请稍后恢复。"; }
  start() {
    this.enabled = true;
    const epoch = ++this.epoch;
    void this.restore(epoch);
  }
  dispose() {
    this.enabled = false; ++this.epoch;
    this.stream?.close(); this.stream = null; clearTimeout(this.timer);
  }
  async refreshConfiguration() {
    const epoch = this.epoch;
    try {
      const configuration = await this.dependencies.request<AiConfiguration>("/api/ai/status");
      if (this.live(epoch)) this.update({ configuration });
    } catch (error) { if (this.live(epoch)) this.update({ error: this.error(error) }); }
  }
  private async loadHistory(epoch: number) {
    const snapshot = await this.dependencies.request<ConversationSnapshot>(this.projectUrl);
    if (!this.live(epoch)) return;
    this.update({ messages: snapshot.messages, activeRun: snapshot.activeRun, historyReady: true });
    this.watch();
  }
  private async restore(epoch: number) {
    try {
      this.update({ loading: true, error: null });
      this.update({ pending: this.dependencies.readPending() });
      await Promise.all([this.refreshConfiguration(), this.loadHistory(epoch)]);
      if (this.live(epoch) && this.state.pending) await this.resolvePending(false);
    } catch (error) { if (this.live(epoch)) this.update({ error: this.error(error) }); }
    finally { if (this.live(epoch)) this.update({ loading: false }); }
  }
  async refresh() { await this.restore(this.epoch); }
  async send(message: string): Promise<boolean> {
    if (!this.enabled || !this.state.historyReady || this.state.loading || this.state.submitting || (this.state.activeRun && !isTerminal(this.state.activeRun.status)) || this.state.pending) return false;
    if (!message.trim() || message.length > 8000) { this.update({ error: "请输入 1–8000 字的消息。" }); return false; }
    const pending = { clientRequestId: this.dependencies.uuid(), message };
    try { this.remember(pending); }
    catch { this.update({ error: "无法保存发送标识，请允许此站点使用本地存储后重试。" }); return false; }
    return this.submit(pending);
  }
  private async submit(pending: PendingRequest): Promise<boolean> {
    const epoch = this.epoch;
    this.update({ submitting: true, error: null });
    try {
      const { run } = await this.dependencies.request<{ run: AiRun }>(this.projectUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending, ...(this.conversationId ? { conversationId: this.conversationId } : {}) }) });
      if (!this.live(epoch)) return true;
      this.update({ activeRun: run, messages: this.state.messages.some((message) => message.runId === run.id) ? this.state.messages : [
        ...this.state.messages,
        { id: `${run.id}:user`, runId: run.id, role: "user", content: pending.message, status: "submitted", createdAt: run.createdAt, errorCode: null },
        { id: `${run.id}:assistant`, runId: run.id, role: "assistant", content: run.output, status: run.status, createdAt: run.createdAt, errorCode: run.errorCode },
      ] });
      this.remember(null);
      this.watch();
      await this.loadHistory(epoch).catch(() => { if (this.live(epoch)) this.update({ error: "消息已提交，历史记录暂时未能刷新，请恢复记录。" }); });
      return true;
    } catch (error) {
      if (this.live(epoch)) {
        const definite = error instanceof ChatRequestError && ["INVALID_INPUT", "CONFIG_MISSING", "LOCAL_ONLY", "PROJECT_NOT_FOUND", "RUN_ACTIVE", "CAPACITY_LIMIT", "REQUEST_CONFLICT"].includes(error.code);
        if (definite) { try { this.remember(null); } catch {} }
        this.update({ error: definite ? this.error(error) : "发送结果尚未确认，请核对本次发送；不要重复发送新消息。" });
        // Another tab may have created a run. Recover it without issuing a new POST.
        if (error instanceof ChatRequestError && error.code === "RUN_ACTIVE") await this.loadHistory(epoch).catch(() => {});
      }
      return false;
    } finally { if (this.live(epoch)) this.update({ submitting: false }); }
  }
  async resolvePending(retry: boolean) {
    const pending = this.state.pending, epoch = this.epoch;
    if (!pending || this.state.submitting) return;
    this.update({ submitting: true, error: null });
    try {
      const { run } = await this.dependencies.request<{ run: AiRun }>(`${this.projectUrl}${this.projectUrl.includes("?") ? "&" : "?"}clientRequestId=${encodeURIComponent(pending.clientRequestId)}`);
      if (!this.live(epoch)) return;
      this.update({ activeRun: run });
      this.remember(null);
      this.watch();
      await this.loadHistory(epoch);
    } catch (error) {
      if (!this.live(epoch)) return;
      if (error instanceof ChatRequestError && error.code === "RUN_NOT_FOUND") {
        if (retry) { this.update({ submitting: false }); await this.submit(pending); }
        else this.update({ error: "未查到本次发送。点击“核对并重试”会沿用原标识，避免重复提交。" });
      } else this.update({ error: this.error(error) });
    } finally { if (this.live(epoch)) this.update({ submitting: false }); }
  }
  private applyRun(run: AiRun) {
    const current = this.state.activeRun;
    if (!current || current.id !== run.id || run.sequence < current.sequence) return;
    this.update({ activeRun: run, messages: this.state.messages.map((message) => message.role === "assistant" && message.runId === run.id
      ? { ...message, content: run.output, status: run.status, errorCode: run.errorCode } : message) });
  }
  private watch() {
    this.stream?.close(); this.stream = null;
    clearTimeout(this.timer);
    const run = this.state.activeRun;
    if (!run || isTerminal(run.status)) return;
    const epoch = this.epoch;
    try {
      const stream = this.dependencies.stream(`/api/ai/runs/${run.id}/events?after=${run.sequence}`);
      this.stream = stream;
      stream.onmessage = (event) => {
        if (!this.live(epoch) || this.stream !== stream) return;
        const current = this.state.activeRun;
        const sequence = Number(event.lastEventId);
        if (!current || current.id !== run.id || !Number.isSafeInteger(sequence) || sequence <= current.sequence) return;
        // Gaps and terminal events are resolved by polling a durable snapshot.
        try {
          const data = JSON.parse(event.data);
          if (sequence === current.sequence + 1 && data.type === "status" && ["queued", "running"].includes(data.status)) {
            this.applyRun({ ...current, sequence, status: data.status }); return;
          }
          if (sequence !== current.sequence + 1 || data.type !== "delta" || typeof data.text !== "string") return;
          this.applyRun({ ...current, sequence, output: current.output + data.text });
          this.update({ connection: "connected" });
        } catch { /* The independent snapshot query remains authoritative. */ }
      };
      stream.onerror = () => {
        if (this.stream !== stream) return;
        stream.close(); this.stream = null;
        if (this.live(epoch)) this.update({ connection: "reconnecting" });
      };
    } catch { this.update({ connection: "reconnecting" }); }
    this.timer = setTimeout(() => { void this.poll(epoch); }, 1000);
  }
  private async poll(epoch: number) {
    if (!this.live(epoch) || this.polling) return;
    const active = this.state.activeRun;
    if (!active) return;
    this.polling = true;
    try {
      const { run } = await this.dependencies.request<{ run: AiRun }>(`/api/ai/runs/${active.id}`);
      if (!this.live(epoch)) return;
      this.applyRun(run);
      this.update({ connection: "connected" });
      if (isTerminal(run.status)) { this.update({ stopping: false, error: null }); await this.loadHistory(epoch); }
    } catch { if (this.live(epoch)) this.update({ connection: "reconnecting" }); }
    finally {
      this.polling = false;
      if (this.live(epoch) && this.state.activeRun && !isTerminal(this.state.activeRun.status)) {
        clearTimeout(this.timer);
        if (!this.stream) this.watch(); else this.timer = setTimeout(() => { void this.poll(epoch); }, 1000);
      }
    }
  }
  async stop() {
    const run = this.state.activeRun, epoch = this.epoch;
    if (!run || isTerminal(run.status) || this.state.stopping) return;
    this.update({ stopping: true, error: null });
    try {
      const { run: stopped } = await this.dependencies.request<{ run: AiRun }>(`/api/ai/runs/${run.id}/stop`, { method: "POST" });
      if (!this.live(epoch)) return;
      this.applyRun(stopped);
      await this.loadHistory(epoch);
    } catch { if (this.live(epoch)) this.update({ error: "停止尚未确认，可再次点击停止；回复状态会继续核对。" }); }
    finally { if (this.live(epoch)) this.update({ stopping: false }); }
  }
}

export function createBrowserSession(projectId: string, conversationId?: string) {
  const legacyKey = `mowo:ai:pending:${projectId}`;
  const key = conversationId ? `${legacyKey}:${conversationId}` : legacyKey;
  const legacy = !conversationId || conversationId === `legacy:${projectId}`;
  return new ChatSession(projectId, {
    uuid: () => crypto.randomUUID(),
    readPending: () => {
      const raw = localStorage.getItem(key) ?? (legacy ? localStorage.getItem(legacyKey) : null);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (typeof value?.message !== "string" || value.message.length > 8000 || !/^[A-Za-z0-9_-]{8,100}$/.test(value.clientRequestId)) throw new Error("本地发送恢复记录无效，请检查浏览器存储。");
      return value as PendingRequest;
    },
    writePending: (pending) => {
      if (pending) localStorage.setItem(key, JSON.stringify(pending));
      else { localStorage.removeItem(key); if (legacy) localStorage.removeItem(legacyKey); }
    },
    stream: (path) => new EventSource(path),
    request: async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new ChatRequestError(data.code ?? "HTTP_ERROR", data.error ?? "对话服务暂不可用。");
      return data as T;
    },
  }, conversationId);
}
