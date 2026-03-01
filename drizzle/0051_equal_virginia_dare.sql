ALTER TABLE `userPreferences` ADD `lastSweepAt` bigint;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `lastSweepAlertCount` int DEFAULT 0 NOT NULL;