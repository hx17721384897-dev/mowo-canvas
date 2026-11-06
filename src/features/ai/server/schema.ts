import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "../../assets/server/schema";

export const aiConversations = sqliteTable("ai_conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新会话"),
  customTitle: integer("custom_title", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("ai_conversation_project_index").on(table.projectId)]);

export const aiRuns = sqliteTable("ai_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => aiConversations.id, { onDelete: "cascade" }),
  clientRequestId: text("client_request_id").notNull(),
  inputHash: text("input_hash").notNull(),
  model: text("model").notNull(),
  inputJson: text("input_json").notNull(),
  status: text("status").notNull(),
  output: text("output").notNull().default(""),
  sequence: integer("sequence").notNull().default(0),
  errorCode: text("error_code"),
  usageJson: text("usage_json"),
  leaseToken: text("lease_token"),
  leaseUntil: integer("lease_until"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("ai_run_request_unique").on(table.projectId, table.clientRequestId),
  uniqueIndex("ai_run_active_conversation_unique").on(table.conversationId).where(sql`${table.status} in ('queued', 'running')`),
]);

export const aiMessages = sqliteTable("ai_messages", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("ai_message_run_role_unique").on(table.runId, table.role)]);

export const aiEvents = sqliteTable("ai_events", {
  runId: text("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.sequence] }), index("ai_event_run_index").on(table.runId)]);
