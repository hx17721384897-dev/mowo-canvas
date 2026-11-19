CREATE TABLE `video_clip_drafts` (
	`project_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`start_frame` integer,
	`end_frame` integer,
	`start_seconds` real,
	`end_seconds` real,
	`name` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `source_asset_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
