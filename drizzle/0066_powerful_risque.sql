CREATE TABLE `paperTradingOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`strategy` varchar(30) NOT NULL,
	`action` varchar(10) NOT NULL DEFAULT 'STO',
	`optionType` varchar(10),
	`strike` varchar(20),
	`expiration` varchar(10),
	`dte` int,
	`premiumCents` int,
	`contracts` int NOT NULL DEFAULT 1,
	`totalPremiumCents` int,
	`delta` varchar(10),
	`status` enum('open','closed','expired') NOT NULL DEFAULT 'open',
	`pnlCents` int,
	`orderSnapshot` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paperTradingOrders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `paperTradingOrders` ADD CONSTRAINT `paperTradingOrders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `paperTradingOrders_userId_idx` ON `paperTradingOrders` (`userId`);--> statement-breakpoint
CREATE INDEX `paperTradingOrders_status_idx` ON `paperTradingOrders` (`status`);