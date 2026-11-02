CREATE TABLE `asset_collection_items` (
	`collection_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `asset_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `asset_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_collection_position_unique` ON `asset_collection_items` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `asset_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`original_name` text NOT NULL,
	`relative_path` text,
	`text_content` text,
	`mime_type` text,
	`size` integer,
	`width` integer,
	`height` integer,
	`duration` integer,
	`source_type` text NOT NULL,
	`source_url` text,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_content_hash_unique` ON `assets` (`content_hash`);--> statement-breakpoint
CREATE INDEX `assets_deleted_at_index` ON `assets` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `project_assets` (
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `asset_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `project_assets_asset_id_index` ON `project_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
