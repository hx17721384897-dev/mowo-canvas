CREATE TABLE `asset_derivation_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`derivation_id` text NOT NULL,
	`asset_id` text,
	`collection_id` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`derivation_id`) REFERENCES `asset_derivations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`collection_id`) REFERENCES `asset_collections`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `asset_derivation_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`derivation_id` text NOT NULL,
	`asset_id` text,
	`collection_id` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`derivation_id`) REFERENCES `asset_derivations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`collection_id`) REFERENCES `asset_collections`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `asset_derivations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`processor_version` text NOT NULL,
	`parameters_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `frame_extraction_frames` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_position` integer NOT NULL,
	`position` integer NOT NULL,
	`relative_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`timeline_start_ms` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`retained` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `frame_extraction_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_extraction_frame_source_position_unique` ON `frame_extraction_frames` (`source_id`,`position`);--> statement-breakpoint
CREATE TABLE `frame_extraction_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`width` integer,
	`height` integer,
	`total_duration_ms` integer,
	`collection_id` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`task_id`) REFERENCES `frame_extraction_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`collection_id`) REFERENCES `asset_collections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_extraction_source_task_position_unique` ON `frame_extraction_sources` (`task_id`,`position`);--> statement-breakpoint
CREATE TABLE `frame_extraction_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `frame_extraction_tasks_project_index` ON `frame_extraction_tasks` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_asset_collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_position` integer,
	`timeline_start_ms` integer,
	`duration_ms` integer,
	FOREIGN KEY (`collection_id`) REFERENCES `asset_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_asset_collection_items`("id", "collection_id", "asset_id", "position", "source_position", "timeline_start_ms", "duration_ms") SELECT lower(hex(randomblob(16))), "collection_id", "asset_id", "position", "position", NULL, NULL FROM `asset_collection_items`;--> statement-breakpoint
DROP TABLE `asset_collection_items`;--> statement-breakpoint
ALTER TABLE `__new_asset_collection_items` RENAME TO `asset_collection_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_collection_position_unique` ON `asset_collection_items` (`collection_id`,`position`);--> statement-breakpoint
ALTER TABLE `asset_collections` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `asset_collections` ADD `kind` text DEFAULT 'download-batch' NOT NULL;
