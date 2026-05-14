CREATE TABLE `positionTargets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`accountNumber` varchar(32) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`optionSymbol` varchar(32) NOT NULL,
	`optionType` varchar(4) NOT NULL,
	`strike` varchar(20) NOT NULL,
	`expiration` varchar(20) NOT NULL,
	`quantity` int NOT NULL,
	`premiumCollected` varchar(20) NOT NULL,
	`profitTargetPct` int NOT NULL DEFAULT 50,
	`enabled` boolean NOT NULL DEFAULT true,
	`status` enum('watching','triggered','closed','expired','error') NOT NULL DEFAULT 'watching',
	`lastCheckedAt` timestamp,
	`lastProfitPct` varchar(10),
	`closedAt` timestamp,
	`closedOrderId` varchar(64),
	`errorMessage` text,
	`strategy` varchar(30) DEFAULT 'csp',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positionTargets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `positionTargets` ADD CONSTRAINT `positionTargets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `positionTargets_userId_idx` ON `positionTargets` (`userId`);--> statement-breakpoint
CREATE INDEX `positionTargets_account_idx` ON `positionTargets` (`accountId`);--> statement-breakpoint
CREATE INDEX `positionTargets_status_idx` ON `positionTargets` (`status`);--> statement-breakpoint
CREATE INDEX `positionTargets_optionSymbol_idx` ON `positionTargets` (`optionSymbol`);