CREATE TABLE `broadcasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sentByAdminId` int NOT NULL,
	`targetTier` enum('all','free_trial','wheel','advanced') NOT NULL DEFAULT 'all',
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`recipientCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `broadcasts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('bug','feature','question','feedback') NOT NULL,
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`status` enum('new','in_progress','resolved','closed') NOT NULL DEFAULT 'new',
	`subject` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`pageUrl` varchar(500),
	`screenshotUrl` varchar(500),
	`userAgent` text,
	`assignedToAdminId` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedbackReplies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feedbackId` int NOT NULL,
	`userId` int NOT NULL,
	`isAdminReply` boolean NOT NULL DEFAULT false,
	`message` text NOT NULL,
	`isInternalNote` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feedbackReplies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userActivity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`activityType` enum('login','logout','page_view','api_call','strategy_view','opportunity_fetch','trade_submit','preset_change','watchlist_update') NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userActivity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `broadcasts` ADD CONSTRAINT `broadcasts_sentByAdminId_users_id_fk` FOREIGN KEY (`sentByAdminId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_assignedToAdminId_users_id_fk` FOREIGN KEY (`assignedToAdminId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedbackReplies` ADD CONSTRAINT `feedbackReplies_feedbackId_feedback_id_fk` FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedbackReplies` ADD CONSTRAINT `feedbackReplies_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userActivity` ADD CONSTRAINT `userActivity_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `broadcasts_createdAt_idx` ON `broadcasts` (`createdAt`);--> statement-breakpoint
CREATE INDEX `feedback_userId_idx` ON `feedback` (`userId`);--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`);--> statement-breakpoint
CREATE INDEX `feedback_createdAt_idx` ON `feedback` (`createdAt`);--> statement-breakpoint
CREATE INDEX `feedbackReplies_feedbackId_idx` ON `feedbackReplies` (`feedbackId`);--> statement-breakpoint
CREATE INDEX `userActivity_userId_idx` ON `userActivity` (`userId`);--> statement-breakpoint
CREATE INDEX `userActivity_activityType_idx` ON `userActivity` (`activityType`);--> statement-breakpoint
CREATE INDEX `userActivity_createdAt_idx` ON `userActivity` (`createdAt`);