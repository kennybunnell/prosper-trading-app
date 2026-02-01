CREATE TABLE `broadcastReads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`broadcastId` int NOT NULL,
	`userId` int NOT NULL,
	`isRead` boolean NOT NULL DEFAULT false,
	`isDeleted` boolean NOT NULL DEFAULT false,
	`readAt` timestamp,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `broadcastReads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `videoUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `feedbackReplies` ADD `videoUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `feedbackReplies` ADD `readByUser` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `broadcastReads` ADD CONSTRAINT `broadcastReads_broadcastId_broadcasts_id_fk` FOREIGN KEY (`broadcastId`) REFERENCES `broadcasts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `broadcastReads` ADD CONSTRAINT `broadcastReads_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `broadcastReads_broadcastUser_idx` ON `broadcastReads` (`broadcastId`,`userId`);--> statement-breakpoint
CREATE INDEX `broadcastReads_userId_idx` ON `broadcastReads` (`userId`);