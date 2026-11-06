import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { AiRun, ChatMessage, ConversationSnapshot, ConversationSummary, RunStatus, StoredChatMessage } from "../types.ts";

type Row = {
  id: string; project_id: string; conversation_id: string | null; client_request_id: string; input_hash: string;
  model: string; input_json: string; status: RunStatus; output: string; sequence: number;
  error_code: string | null; usage_json: string | null; lease_token: string | null;
  lease_until: number | null; created_at: number; updated_at: number;
};
export class RunError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
export const LEASE_MS = 15_000;
export const MAX_INPUT_CHARS = 8000;
const CONTEXT_CHARS = 16000;

// Shared by Next.js and the standalone worker. All mutations use immediate SQLite
// transactions; the worker's token and unexpired lease fence every output write.
export class RunStore {
  db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }
  close() { this.db.close(); }
  row(id: string) { return this.db.prepare("SELECT * FROM ai_runs WHERE id = ?").get(id) as Row | undefined; }
  view(row: Row): AiRun {
    return { id: row.id, projectId: row.project_id, clientRequestId: row.client_request_id,
      conversationId: row.conversation_id ?? undefined, model: row.model, status: row.status, output: row.output, sequence: row.sequence,
      errorCode: row.error_code, usage: row.usage_json ? JSON.parse(row.usage_json) : null,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  get(id: string) {
    const row = this.row(id);
    if (!row) throw new RunError("RUN_NOT_FOUND", 404);
    return this.view(row);
  }
  projectExists(projectId: string) {
    if (!this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new RunError("PROJECT_NOT_FOUND", 404);
  }
  find(projectId: string, requestId: string) {
    this.projectExists(projectId);
    const row = this.db.prepare("SELECT * FROM ai_runs WHERE project_id = ? AND client_request_id = ?").get(projectId, requestId) as Row | undefined;
    if (!row) throw new RunError("RUN_NOT_FOUND", 404);
    return this.view(row);
  }
  conversationId(projectId: string, requested?: string) {
    this.projectExists(projectId);
    const id = requested ?? `legacy:${projectId}`;
    if (requested && !this.db.prepare("SELECT 1 FROM ai_conversations WHERE id=? AND project_id=?").get(id, projectId)) throw new RunError("CONVERSATION_NOT_FOUND", 404);
    return id;
  }
  conversations(projectId: string, search = ""): ConversationSummary[] {
    this.projectExists(projectId);
    return this.db.prepare(`SELECT c.id,c.project_id AS projectId,p.name AS projectName,c.title,c.created_at AS createdAt,c.updated_at AS updatedAt
      FROM ai_conversations c JOIN projects p ON p.id=c.project_id
      WHERE c.project_id=? AND instr(lower(c.title),lower(?))>0
      ORDER BY c.updated_at DESC,c.created_at DESC,c.id`).all(projectId, search.trim()) as ConversationSummary[];
  }
  createConversation(projectId: string) {
    return this.db.transaction(() => {
      this.projectExists(projectId);
      // Repeated clicks or a lost create response reuse the same untouched blank.
      const blank = this.db.prepare(`SELECT id FROM ai_conversations c WHERE project_id=? AND custom_title=0
        AND NOT EXISTS (SELECT 1 FROM ai_runs r WHERE r.conversation_id=c.id) ORDER BY created_at DESC LIMIT 1`).get(projectId) as { id: string } | undefined;
      const id = blank?.id ?? randomUUID(), now = Date.now();
      if (!blank) this.db.prepare("INSERT INTO ai_conversations (id,project_id,title,custom_title,created_at,updated_at) VALUES (?,?,'新会话',0,?,?)").run(id, projectId, now, now);
      return this.conversations(projectId).find((item) => item.id === id)!;
    }).immediate();
  }
  renameConversation(projectId: string, id: string, title: string) {
    this.conversationId(projectId, id);
    const name = title.trim();
    if (!name || name.length > 80) throw new RunError("INVALID_TITLE");
    this.db.prepare("UPDATE ai_conversations SET title=?,custom_title=1,updated_at=? WHERE id=? AND project_id=?").run(name, Date.now(), id, projectId);
    return this.conversations(projectId).find((item) => item.id === id)!;
  }
  history(projectId: string, requestedConversationId?: string) {
    this.projectExists(projectId);
    const conversationId = this.conversationId(projectId, requestedConversationId);
    return this.db.prepare(`SELECT m.id, m.run_id AS runId, m.role, m.content, m.status, r.error_code AS errorCode, m.created_at AS createdAt
      FROM ai_messages m JOIN ai_runs r ON m.run_id = r.id WHERE r.project_id = ? AND r.conversation_id=?
      ORDER BY r.created_at, r.rowid, CASE m.role WHEN 'user' THEN 0 ELSE 1 END`).all(projectId, conversationId) as StoredChatMessage[];
  }
  conversation(projectId: string, requestedConversationId?: string): ConversationSnapshot {
    return this.db.transaction(() => {
      const messages = this.history(projectId, requestedConversationId);
      const id = this.conversationId(projectId, requestedConversationId);
      const row = this.db.prepare("SELECT * FROM ai_runs WHERE project_id=? AND conversation_id=? AND status IN ('queued','running')").get(projectId, id) as Row | undefined;
      return { messages, activeRun: row ? this.view(row) : null };
    }).deferred();
  }
  create(projectId: string, requestId: string, message: string, requestedConversationId?: string) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId) || !message.trim() || message.length > MAX_INPUT_CHARS) throw new RunError("INVALID_INPUT");
    const model = "deepseek-flash";
    return this.db.transaction(() => {
      this.projectExists(projectId);
      const conversationId = this.conversationId(projectId, requestedConversationId);
      const hash = createHash("sha256").update(JSON.stringify({ message, model, conversationId })).digest("hex");
      const existing = this.db.prepare("SELECT * FROM ai_runs WHERE project_id = ? AND client_request_id = ?").get(projectId, requestId) as Row | undefined;
      if (existing) {
        // Legacy hashes were computed before conversation IDs existed.
        const oldHash = createHash("sha256").update(JSON.stringify({ message, model })).digest("hex");
        if (existing.input_hash !== hash && !(existing.conversation_id === conversationId && existing.input_hash === oldHash)) throw new RunError("REQUEST_CONFLICT", 409);
        return { run: this.view(existing), created: false };
      }
      if (this.db.prepare("SELECT 1 FROM ai_runs WHERE conversation_id = ? AND status IN ('queued', 'running')").get(conversationId)) throw new RunError("RUN_ACTIVE", 409);
      const active = this.db.prepare("SELECT count(*) AS n FROM ai_runs WHERE status IN ('queued','running')").get() as { n: number };
      if (active.n >= 3) throw new RunError("CAPACITY_LIMIT", 429);
      const messages: ChatMessage[] = [];
      let budget = CONTEXT_CHARS - message.length;
      const rows = this.db.prepare("SELECT * FROM ai_runs WHERE project_id = ? AND conversation_id=? AND status = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 40").all(projectId, conversationId) as Row[];
      for (const row of rows) {
        const input = JSON.parse(row.input_json) as ChatMessage[];
        const user = input.at(-1)!;
        if (user.content.length + row.output.length > budget) break;
        messages.unshift(user, { role: "assistant", content: row.output });
        budget -= user.content.length + row.output.length;
      }
      messages.push({ role: "user", content: message });
      const id = randomUUID(), now = Date.now();
      this.db.prepare("INSERT OR IGNORE INTO ai_conversations (id,project_id,title,custom_title,created_at,updated_at) VALUES (?,?,'新会话',0,?,?)").run(conversationId, projectId, now, now);
      const first = !this.db.prepare("SELECT 1 FROM ai_runs WHERE conversation_id=?").get(conversationId);
      const title = Array.from(message.replace(/\s+/g, " ").trim()).slice(0, 60).join("");
      this.db.prepare("UPDATE ai_conversations SET title=CASE WHEN custom_title=0 AND ? THEN ? ELSE title END,updated_at=? WHERE id=?").run(first ? 1 : 0, title, now, conversationId);
      this.db.prepare(`INSERT INTO ai_runs (id,project_id,conversation_id,client_request_id,input_hash,model,input_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'queued',?,?)`).run(id, projectId, conversationId, requestId, hash, model, JSON.stringify(messages), now, now);
      const insert = this.db.prepare("INSERT INTO ai_messages (id,run_id,role,content,status,created_at) VALUES (?,?,?,?,?,?)");
      insert.run(randomUUID(), id, "user", message, "submitted", now);
      insert.run(randomUUID(), id, "assistant", "", "queued", now);
      this.event(id, { type: "status", status: "queued" });
      return { run: this.get(id), created: true };
    }).immediate();
  }
  private event(id: string, payload: object) {
    this.db.prepare("UPDATE ai_runs SET sequence = sequence + 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
    this.db.prepare("INSERT INTO ai_events (run_id,sequence,payload_json) SELECT id,sequence,? FROM ai_runs WHERE id = ?").run(JSON.stringify(payload), id);
  }
  events(id: string, after: number) {
    return this.db.prepare("SELECT sequence, payload_json AS payload FROM ai_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT 100").all(id, after) as { sequence: number; payload: string }[];
  }
  pending() { return this.db.prepare("SELECT id FROM ai_runs WHERE status = 'queued'").all() as { id: string }[]; }
  failQueued(id: string) {
    return this.db.transaction(() => {
      if (this.row(id)?.status === "queued") this.finish(id, "failed", "WORKER_START_FAILED");
    }).immediate();
  }
  claim(id: string, token: string, now = Date.now()) {
    return this.db.transaction(() => {
      if (!this.db.prepare("UPDATE ai_runs SET status='running',lease_token=?,lease_until=? WHERE id=? AND status='queued'").run(token, now + LEASE_MS, id).changes) return false;
      this.db.prepare("UPDATE ai_messages SET status='running' WHERE run_id=? AND role='assistant'").run(id);
      this.event(id, { type: "status", status: "running" });
      return true;
    }).immediate();
  }
  renew(id: string, token: string, now = Date.now()) {
    return this.db.prepare("UPDATE ai_runs SET lease_until=? WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").run(now + LEASE_MS, id, token, now).changes === 1;
  }
  append(id: string, token: string, text: string, now = Date.now()) {
    return this.db.transaction(() => {
      if (!this.db.prepare("UPDATE ai_runs SET output=output||? WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").run(text, id, token, now).changes) return false;
      this.db.prepare("UPDATE ai_messages SET content=content||? WHERE run_id=? AND role='assistant'").run(text, id);
      this.event(id, { type: "delta", text });
      return true;
    }).immediate();
  }
  finish(id: string, status: RunStatus, errorCode: string | null = null, token?: string, usage: object | null = null, now = Date.now()) {
    return this.db.transaction(() => {
      const condition = token ? "status='running' AND lease_token=@token AND lease_until>@now" : "status IN ('queued','running')";
      const changed = this.db.prepare(`UPDATE ai_runs SET status=@status,error_code=@errorCode,usage_json=@usage,lease_until=NULL
        WHERE id=@id AND ${condition}`).run({ id, status, errorCode, usage: usage ? JSON.stringify(usage) : null, token: token ?? null, now }).changes;
      if (!changed) return false;
      this.db.prepare("UPDATE ai_messages SET status=? WHERE run_id=? AND role='assistant'").run(status, id);
      this.event(id, { type: "status", status, errorCode, usage });
      return true;
    }).immediate();
  }
  recover(now = Date.now()) {
    return this.db.transaction(() => {
      const expired = this.db.prepare("SELECT id FROM ai_runs WHERE status='running' AND lease_until<=?").all(now) as { id: string }[];
      for (const { id } of expired) this.finish(id, "interrupted", "WORKER_LOST");
      return expired.length;
    }).immediate();
  }
}
