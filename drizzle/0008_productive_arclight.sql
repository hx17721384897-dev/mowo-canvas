CREATE TABLE `video_clips` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`start_frame` integer NOT NULL,
	`end_frame` integer NOT NULL,
	`start_pts` integer NOT NULL,
	`end_pts` integer NOT NULL,
	`time_base_numerator` integer NOT NULL,
	`time_base_denominator` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_clips_source_sequence_unique` ON `video_clips` (`project_id`,`source_asset_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `video_clips_source_index` ON `video_clips` (`source_asset_id`);