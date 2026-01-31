CREATE TABLE `paperTradingPerformance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`month` varchar(7) NOT NULL,
	`netPremium` int NOT NULL,
	`cumulativeTotal` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTradingPerformance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `paperTradingPerformance` ADD CONSTRAINT `paperTradingPerformance_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `paperTradingPerformance_userId_idx` ON `paperTradingPerformance` (`userId`);--> statement-breakpoint
CREATE INDEX `paperTradingPerformance_month_idx` ON `paperTradingPerformance` (`month`);