CREATE TABLE `pinned_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`prompt` text NOT NULL,
	`report_type` enum('standard','ai') NOT NULL DEFAULT 'ai',
	`report_key` varchar(64),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_visible` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pinned_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `pinned_reports` ADD CONSTRAINT `pinned_reports_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pinned_reports_user_id_idx` ON `pinned_reports` (`user_id`);