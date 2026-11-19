import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  videoMetadataJson: text("video_metadata_json"),
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

export const assetFolders = sqliteTable("asset_folders", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceCategory: text("source_category", { enum: ["download", "import"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("asset_folders_project_index").on(table.projectId)]);

export const assetFolderItems = sqliteTable("asset_folder_items", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  folderId: text("folder_id").notNull().references(() => assetFolders.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.projectId, table.assetId] }), index("asset_folder_items_folder_index").on(table.folderId)]);

export const assetIntakes = sqliteTable("asset_intakes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  batchId: text("batch_id").references(() => assetCollections.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("asset_intakes_project_asset_index").on(table.projectId, table.assetId)]);

export const videoClips = sqliteTable("video_clips", {
  id: text("id").primaryKey().references(() => assets.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(),
  startFrame: integer("start_frame").notNull(),
  endFrame: integer("end_frame").notNull(),
  startPts: integer("start_pts").notNull(),
  endPts: integer("end_pts").notNull(),
  timeBaseNumerator: integer("time_base_numerator").notNull(),
  timeBaseDenominator: integer("time_base_denominator").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("video_clips_source_sequence_unique").on(table.projectId, table.sourceAssetId, table.sequence),
  index("video_clips_source_index").on(table.sourceAssetId),
]);

export const videoClipDrafts = sqliteTable("video_clip_drafts", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  startFrame: integer("start_frame"),
  endFrame: integer("end_frame"),
  startSeconds: real("start_seconds"),
  endSeconds: real("end_seconds"),
  name: text("name"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.sourceAssetId] })]);

export const videoCuttingProjects = sqliteTable("video_cutting_projects", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  sourceHash: text("source_hash").notNull(),
  clipsJson: text("clips_json").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.sourceAssetId] })]);

export const videoCuttingOutputs = sqliteTable("video_cutting_outputs", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  projectRevision: integer("project_revision").notNull(),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.sourceAssetId, table.projectRevision] })]);

export const videoShotAnalyses = sqliteTable("video_shot_analyses", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  sourceHash: text("source_hash").notNull(),
  modelHash: text("model_hash").notNull(),
  status: text("status", { enum: ["waiting", "running", "ready", "failed", "interrupted"] }).notNull(),
  progressFrames: integer("progress_frames").notNull().default(0),
  frameCount: integer("frame_count").notNull().default(0),
  cutsJson: text("cuts_json").notNull().default("[]"),
  manualCutsJson: text("manual_cuts_json"),
  editRevision: integer("edit_revision").notNull().default(0),
  device: text("device", { enum: ["cpu", "dml"] }),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.sourceAssetId] })]);

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
  operationType: text("operation_type", { enum: ["frame-extraction", "frame-stitch", "image-crop"] }).notNull(),
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
  // Kept for compatibility with existing SQLite files; no longer used for draft cleanup.
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
  sourceKind: text("source_kind", { enum: ["animated", "video"] }).notNull().default("animated"),
  parametersJson: text("parameters_json").notNull().default("{}"),
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
  sourceMappingJson: text("source_mapping_json"),
}, (table) => [
  uniqueIndex("frame_extraction_frame_source_position_unique").on(table.sourceId, table.position),
]);

export const videoFrameJobs = sqliteTable("video_frame_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  requestId: text("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  mode: text("mode", { enum: ["analyze", "extract"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "cancelling", "ready", "partial", "failed", "cancelled"] }).notNull(),
  executionId: text("execution_id"),
  inputsJson: text("inputs_json").notNull(),
  resultTaskId: text("result_task_id").references(() => frameExtractionTasks.id, { onDelete: "set null" }),
  errorCode: text("error_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("video_frame_jobs_request_unique").on(table.projectId, table.requestId),
  index("video_frame_jobs_queue_index").on(table.status, table.createdAt),
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

export const videoDownloadTasks = sqliteTable("video_download_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  bvid: text("bvid").notNull(),
  cid: text("cid"),
  part: integer("part").notNull(),
  title: text("title").notNull(),
  formatIdsJson: text("format_ids_json").notNull(),
  status: text("status", { enum: ["queued", "downloading", "merging", "verifying", "ready", "importing", "completed", "failed", "cancelled", "interrupted"] }).notNull().default("queued"),
  executionId: text("execution_id"),
  retryCount: integer("retry_count").notNull().default(0),
  downloadedBytes: integer("downloaded_bytes"),
  totalBytes: integer("total_bytes"),
  speed: integer("speed"),
  recoveryMode: text("recovery_mode"),
  relativePath: text("relative_path"),
  metadataJson: text("metadata_json"),
  previewStatus: text("preview_status", { enum: ["not-needed", "pending", "generating", "ready", "failed"] }).notNull().default("pending"),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  errorCode: text("error_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("video_download_project_index").on(table.projectId), index("video_download_status_index").on(table.status)]);
