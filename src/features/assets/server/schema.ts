import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const canvasDocuments = sqliteTable("canvas_documents", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  schemaVersion: integer("schema_version").notNull().default(1),
  nodesJson: text("nodes_json").notNull(),
  edgesJson: text("edges_json").notNull(),
  viewportJson: text("viewport_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["image", "video", "text"] }).notNull(),
  originalName: text("original_name").notNull(),
  relativePath: text("relative_path"),
  textContent: text("text_content"),
  mimeType: text("mime_type"),
  size: integer("size"),
  width: integer("width"),
  height: integer("height"),
  duration: integer("duration"),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  contentHash: text("content_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("assets_content_hash_unique").on(table.contentHash),
  index("assets_deleted_at_index").on(table.deletedAt),
]);

export const projectAssets = sqliteTable("project_assets", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.assetId] }),
  index("project_assets_asset_id_index").on(table.assetId),
]);

export const assetCollections = sqliteTable("asset_collections", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["download-batch", "frame-sequence"] }).notNull().default("download-batch"),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const assetCollectionItems = sqliteTable("asset_collection_items", {
  id: text("id").primaryKey(),
  collectionId: text("collection_id").notNull().references(() => assetCollections.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  sourcePosition: integer("source_position"),
  timelineStartMs: integer("timeline_start_ms"),
  durationMs: integer("duration_ms"),
}, (table) => [
  uniqueIndex("asset_collection_position_unique").on(table.collectionId, table.position),
]);

export const assetDerivations = sqliteTable("asset_derivations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  operationType: text("operation_type", { enum: ["frame-extraction"] }).notNull(),
  processorVersion: text("processor_version").notNull(),
  parametersJson: text("parameters_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const assetDerivationInputs = sqliteTable("asset_derivation_inputs", {
  id: text("id").primaryKey(),
  derivationId: text("derivation_id").notNull().references(() => assetDerivations.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  collectionId: text("collection_id").references(() => assetCollections.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
});

export const assetDerivationOutputs = sqliteTable("asset_derivation_outputs", {
  id: text("id").primaryKey(),
  derivationId: text("derivation_id").notNull().references(() => assetDerivations.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  collectionId: text("collection_id").references(() => assetCollections.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
});

export const frameExtractionTasks = sqliteTable("frame_extraction_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["processing", "ready", "partial", "failed", "saved"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("frame_extraction_tasks_project_index").on(table.projectId)]);

export const frameExtractionSources = sqliteTable("frame_extraction_sources", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => frameExtractionTasks.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  status: text("status", { enum: ["ready", "failed", "saved"] }).notNull(),
  name: text("name").notNull(),
  width: integer("width"),
  height: integer("height"),
  totalDurationMs: integer("total_duration_ms"),
  collectionId: text("collection_id").references(() => assetCollections.id, { onDelete: "set null" }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
}, (table) => [
  uniqueIndex("frame_extraction_source_task_position_unique").on(table.taskId, table.position),
]);

export const frameExtractionFrames = sqliteTable("frame_extraction_frames", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => frameExtractionSources.id, { onDelete: "cascade" }),
  sourcePosition: integer("source_position").notNull(),
  position: integer("position").notNull(),
  relativePath: text("relative_path").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  timelineStartMs: integer("timeline_start_ms").notNull(),
  durationMs: integer("duration_ms").notNull(),
  retained: integer("retained", { mode: "boolean" }).notNull().default(true),
}, (table) => [
  uniqueIndex("frame_extraction_frame_source_position_unique").on(table.sourceId, table.position),
]);

export const downloadTasks = sqliteTable("download_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["line"] }).notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceKind: text("source_kind", { enum: ["sticker", "emoji"] }),
  title: text("title"),
  status: text("status", { enum: ["queued", "resolving", "downloading", "ready", "importing", "completed", "failed", "cancelled"] }).notNull(),
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("download_tasks_project_id_index").on(table.projectId),
  index("download_tasks_status_index").on(table.status),
]);

export const downloadItems = sqliteTable("download_items", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => downloadTasks.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  relativePath: text("relative_path").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  animated: integer("animated", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("download_items_task_position_unique").on(table.taskId, table.position),
  index("download_items_task_id_index").on(table.taskId),
]);
