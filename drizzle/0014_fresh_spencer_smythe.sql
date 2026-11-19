CREATE TABLE `video_frame_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`node_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`execution_id` text,
	`inputs_json` text NOT NULL,
	`result_task_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_task_id`) REFERENCES `frame_extraction_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_frame_jobs_request_unique` ON `video_frame_jobs` (`project_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `video_frame_jobs_queue_index` ON `video_frame_jobs` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `frame_extraction_frames` ADD `source_mapping_json` text;--> statement-breakpoint
ALTER TABLE `frame_extraction_sources` ADD `source_kind` text DEFAULT 'animated' NOT NULL;--> statement-breakpoint
ALTER TABLE `frame_extraction_sources` ADD `parameters_json` text DEFAULT '{}' NOT NULL;