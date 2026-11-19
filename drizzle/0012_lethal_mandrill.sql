ALTER TABLE `video_shot_analyses` ADD `manual_cuts_json` text;--> statement-breakpoint
ALTER TABLE `video_shot_analyses` ADD `edit_revision` integer DEFAULT 0 NOT NULL;