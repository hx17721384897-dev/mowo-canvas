CREATE TABLE `download_items` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`animated` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `download_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_items_task_position_unique` ON `download_items` (`task_id`,`position`);--> statement-breakpoint
CREATE INDEX `download_items_task_id_index` ON `download_items` (`task_id`);--> statement-breakpoint
CREATE TABLE `download_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`platform` text NOT NULL,
	`source_url` text NOT NULL,
	`source_kind` text,
	`title` text,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `download_tasks_project_id_index` ON `download_tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `download_tasks_status_index` ON `download_tasks` (`status`);