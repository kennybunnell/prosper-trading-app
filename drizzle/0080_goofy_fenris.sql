ALTER TABLE `feedback` ADD `archived` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `archivedAt` bigint;--> statement-breakpoint
ALTER TABLE `feedback` ADD `deletedAt` bigint;--> statement-breakpoint
CREATE INDEX `feedback_archived_idx` ON `feedback` (`archived`);