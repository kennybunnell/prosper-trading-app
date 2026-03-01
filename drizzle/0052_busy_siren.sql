CREATE TABLE `scan_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`scan_type` varchar(20) NOT NULL,
	`ran_at` bigint NOT NULL,
	`alert_count` int NOT NULL DEFAULT 0,
	`accounts_scanned` int NOT NULL DEFAULT 0,
	`triggered_by` varchar(20) NOT NULL DEFAULT 'auto',
	`summary_json` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `scan_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `dailyScanEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `scan_history_user_ran_idx` ON `scan_history` (`user_id`,`ran_at`);