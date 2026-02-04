CREATE TABLE `scanConfigurations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`strategy` enum('csp','cc','bps','bcs') NOT NULL,
	`configName` varchar(128) NOT NULL,
	`tickers` text NOT NULL,
	`filters` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scanConfigurations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `scanConfigurations` ADD CONSTRAINT `scanConfigurations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;