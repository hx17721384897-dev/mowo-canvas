CREATE TABLE `ai_events` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`run_id`, `sequence`),
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_event_run_index` ON `ai_events` (`run_id`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_message_run_role_unique` ON `ai_messages` (`run_id`,`role`);--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`model` text NOT NULL,
	`input_json` text NOT NULL,
	`status` text NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`usage_json` text,
	`lease_token` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_request_unique` ON `ai_runs` (`project_id`,`client_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_active_project_unique` ON `ai_runs` (`project_id`) WHERE "ai_runs"."status" in ('queued', 'running');