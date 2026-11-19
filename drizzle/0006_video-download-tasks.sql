CREATE TABLE `video_download_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_url` text NOT NULL,
	`bvid` text NOT NULL,
	`cid` text,
	`part` integer NOT NULL,
	`title` text NOT NULL,
	`format_ids_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`execution_id` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`downloaded_bytes` integer,
	`total_bytes` integer,
	`speed` integer,
	`recovery_mode` text,
	`relative_path` text,
	`metadata_json` text,
	`preview_status` text DEFAULT 'pending' NOT NULL,
	`asset_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `video_download_project_index` ON `video_download_tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `video_download_status_index` ON `video_download_tasks` (`status`);