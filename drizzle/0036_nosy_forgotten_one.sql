CREATE TABLE `monthlyPremiumCache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`month` varchar(7) NOT NULL,
	`netPremium` varchar(20) NOT NULL,
	`credits` varchar(20) NOT NULL,
	`debits` varchar(20) NOT NULL,
	`transactionCount` int NOT NULL,
	`isLocked` int NOT NULL DEFAULT 0,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monthlyPremiumCache_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_user_account_month` UNIQUE(`userId`,`accountId`,`month`)
);
--> statement-breakpoint
ALTER TABLE `monthlyPremiumCache` ADD CONSTRAINT `monthlyPremiumCache_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `monthlyPremiumCache_userId_idx` ON `monthlyPremiumCache` (`userId`);--> statement-breakpoint
CREATE INDEX `monthlyPremiumCache_month_idx` ON `monthlyPremiumCache` (`month`);