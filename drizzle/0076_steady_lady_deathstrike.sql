CREATE TABLE `bcsAutoEntrySettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`scanTimeET` varchar(8) NOT NULL DEFAULT '10:30',
	`contracts` int NOT NULL DEFAULT 2,
	`spreadWidth` int NOT NULL DEFAULT 50,
	`minScore` int NOT NULL DEFAULT 70,
	`minDTE` int NOT NULL DEFAULT 30,
	`maxDTE` int NOT NULL DEFAULT 45,
	`maxDelta` varchar(10) NOT NULL DEFAULT '0.20',
	`minOI` int NOT NULL DEFAULT 500,
	`maxConcurrent` int NOT NULL DEFAULT 2,
	`approvalTimeoutMins` int NOT NULL DEFAULT 30,
	`accountId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bcsAutoEntrySettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bcsPendingApprovals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`symbol` varchar(16) NOT NULL DEFAULT 'SPXW',
	`shortStrike` varchar(20) NOT NULL,
	`longStrike` varchar(20) NOT NULL,
	`expiration` varchar(20) NOT NULL,
	`dte` int NOT NULL,
	`netCredit` varchar(20) NOT NULL,
	`delta` varchar(20) NOT NULL,
	`score` int NOT NULL DEFAULT 0,
	`contracts` int NOT NULL DEFAULT 2,
	`shortOptionSymbol` varchar(64) NOT NULL,
	`longOptionSymbol` varchar(64) NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`status` enum('pending','approved','skipped','expired','error') NOT NULL DEFAULT 'pending',
	`orderId` varchar(64),
	`errorMessage` text,
	`telegramMessageId` int,
	`expiresAt` timestamp NOT NULL,
	`approvedAt` timestamp,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bcsPendingApprovals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bcsAutoEntrySettings` ADD CONSTRAINT `bcsAutoEntrySettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bcsPendingApprovals` ADD CONSTRAINT `bcsPendingApprovals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bcsAutoEntrySettings_userId_idx` ON `bcsAutoEntrySettings` (`userId`);--> statement-breakpoint
CREATE INDEX `bcsPendingApprovals_userId_idx` ON `bcsPendingApprovals` (`userId`);--> statement-breakpoint
CREATE INDEX `bcsPendingApprovals_status_idx` ON `bcsPendingApprovals` (`status`);--> statement-breakpoint
CREATE INDEX `bcsPendingApprovals_token_idx` ON `bcsPendingApprovals` (`token`);