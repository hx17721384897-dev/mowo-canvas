CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text DEFAULT '新会话' NOT NULL,
	`custom_title` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_conversation_project_index` ON `ai_conversations` (`project_id`);--> statement-breakpoint
DROP INDEX `ai_run_active_project_unique`;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `conversation_id` text REFERENCES ai_conversations(id) ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO `ai_conversations` (`id`,`project_id`,`title`,`custom_title`,`created_at`,`updated_at`)
SELECT 'legacy:' || r.project_id,r.project_id,
  COALESCE((SELECT substr(trim(replace(replace(m.content,char(10),' '),char(13),' ')),1,60)
    FROM ai_messages m JOIN ai_runs first_run ON first_run.id=m.run_id
    WHERE first_run.project_id=r.project_id AND m.role='user'
    ORDER BY first_run.created_at,first_run.rowid LIMIT 1),'历史会话'),
  0,min(r.created_at),max(r.updated_at)
FROM ai_runs r GROUP BY r.project_id;
--> statement-breakpoint
UPDATE `ai_runs` SET `conversation_id`='legacy:' || project_id WHERE conversation_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_active_conversation_unique` ON `ai_runs` (`conversation_id`) WHERE "ai_runs"."status" in ('queued', 'running');
