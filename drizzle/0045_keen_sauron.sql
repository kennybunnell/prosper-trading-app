CREATE TABLE `automationLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`runId` varchar(64) NOT NULL,
	`status` enum('running','completed','failed','cancelled') NOT NULL DEFAULT 'running',
	`triggerType` enum('manual','scheduled') NOT NULL,
	`dryRun` boolean NOT NULL DEFAULT true,
	`positionsClosedCount` int NOT NULL DEFAULT 0,
	`coveredCallsOpenedCount` int NOT NULL DEFAULT 0,
	`totalProfitRealized` varchar(20) NOT NULL DEFAULT '0',
	`totalPremiumCollected` varchar(20) NOT NULL DEFAULT '0',
	`accountsProcessed` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `automationLogs_id` PRIMARY KEY(`id`),
	CONSTRAINT `automationLogs_runId_unique` UNIQUE(`runId`)
);
--> statement-breakpoint
CREATE TABLE `automationPendingOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`accountNumber` varchar(64) NOT NULL,
	`orderType` enum('close_position','open_covered_call') NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`strike` varchar(20),
	`expiration` varchar(20),
	`quantity` int NOT NULL,
	`price` varchar(20) NOT NULL,
	`profitPercent` int,
	`score` int,
	`estimatedProfit` varchar(20),
	`estimatedPremium` varchar(20),
	`status` enum('pending','approved','rejected','submitted','failed') NOT NULL DEFAULT 'pending',
	`orderId` varchar(64),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`approvedAt` timestamp,
	`submittedAt` timestamp,
	CONSTRAINT `automationPendingOrders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automationSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dryRunMode` boolean NOT NULL DEFAULT true,
	`requireApproval` boolean NOT NULL DEFAULT true,
	`autoScheduleEnabled` boolean NOT NULL DEFAULT false,
	`scheduleTime` varchar(10) NOT NULL DEFAULT '09:35',
	`profitThresholdPercent` int NOT NULL DEFAULT 75,
	`ccDteMin` int NOT NULL DEFAULT 7,
	`ccDteMax` int NOT NULL DEFAULT 14,
	`ccDeltaMin` varchar(10) NOT NULL DEFAULT '0.25',
	`ccDeltaMax` varchar(10) NOT NULL DEFAULT '0.30',
	`emailNotificationsEnabled` boolean NOT NULL DEFAULT true,
	`notificationEmail` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automationSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `automationSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `automationLogs` ADD CONSTRAINT `automationLogs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationPendingOrders` ADD CONSTRAINT `automationPendingOrders_runId_automationLogs_runId_fk` FOREIGN KEY (`runId`) REFERENCES `automationLogs`(`runId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationPendingOrders` ADD CONSTRAINT `automationPendingOrders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationSettings` ADD CONSTRAINT `automationSettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `automationLogs_userId_idx` ON `automationLogs` (`userId`);--> statement-breakpoint
CREATE INDEX `automationLogs_runId_idx` ON `automationLogs` (`runId`);--> statement-breakpoint
CREATE INDEX `automationPendingOrders_runId_idx` ON `automationPendingOrders` (`runId`);--> statement-breakpoint
CREATE INDEX `automationPendingOrders_userId_idx` ON `automationPendingOrders` (`userId`);--> statement-breakpoint
CREATE INDEX `automationPendingOrders_status_idx` ON `automationPendingOrders` (`status`);