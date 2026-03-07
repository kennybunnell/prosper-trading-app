CREATE TABLE `gtcOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`sourceOrderId` varchar(64) NOT NULL,
	`sourceStrategy` varchar(30) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`expiration` varchar(20) NOT NULL,
	`premiumCollected` varchar(20) NOT NULL,
	`totalPremiumCollected` varchar(20) NOT NULL,
	`profitTargetPct` int NOT NULL DEFAULT 75,
	`targetClosePrice` varchar(20) NOT NULL,
	`gtcOrderId` varchar(64),
	`submittedAt` timestamp,
	`filledAt` timestamp,
	`cancelledAt` timestamp,
	`status` enum('pending','submitted','filled','cancelled','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gtcOrders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `gtcOrders` ADD CONSTRAINT `gtcOrders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `gtcOrders_userId_idx` ON `gtcOrders` (`userId`);--> statement-breakpoint
CREATE INDEX `gtcOrders_sourceOrder_idx` ON `gtcOrders` (`sourceOrderId`);--> statement-breakpoint
CREATE INDEX `gtcOrders_status_idx` ON `gtcOrders` (`status`);