CREATE TABLE `apiUsage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`scanCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apiUsage_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_user_date` UNIQUE(`userId`,`date`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `subscriptionTier` enum('free_trial','wheel_view','wheel_trading','advanced') DEFAULT 'free_trial';--> statement-breakpoint
ALTER TABLE `apiUsage` ADD CONSTRAINT `apiUsage_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `apiUsage_userId_idx` ON `apiUsage` (`userId`);--> statement-breakpoint
CREATE INDEX `apiUsage_date_idx` ON `apiUsage` (`date`);