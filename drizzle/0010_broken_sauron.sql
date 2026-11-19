CREATE TABLE `video_shot_analyses` (
	`project_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`model_hash` text NOT NULL,
	`status` text NOT NULL,
	`progress_frames` integer DEFAULT 0 NOT NULL,
	`frame_count` integer DEFAULT 0 NOT NULL,
	`cuts_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `source_asset_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
