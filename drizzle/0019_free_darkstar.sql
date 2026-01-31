CREATE TABLE `paperTradingPositions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`companyName` text,
	`quantity` int NOT NULL,
	`costBasis` varchar(20) NOT NULL,
	`currentPrice` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperTradingPositions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `paperTradingPositions` ADD CONSTRAINT `paperTradingPositions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `paperTradingPositions_userId_idx` ON `paperTradingPositions` (`userId`);