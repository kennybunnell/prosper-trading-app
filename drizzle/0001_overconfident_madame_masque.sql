CREATE TABLE `apiCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tastytradeUsername` text,
	`tastytradePassword` text,
	`tradierApiKey` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apiCredentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `apiCredentials_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`positionType` enum('option','stock') NOT NULL,
	`strategy` enum('csp','cc','pmcc','stock'),
	`strike` varchar(20),
	`expiration` varchar(20),
	`quantity` int NOT NULL,
	`costBasis` varchar(20) NOT NULL,
	`currentValue` varchar(20),
	`unrealizedPnL` varchar(20),
	`realizedPnL` varchar(20),
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `premiumTracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`tradeId` int,
	`amount` varchar(20) NOT NULL,
	`type` enum('collected','paid') NOT NULL,
	`strategy` enum('csp','cc','pmcc') NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `premiumTracking_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tastytradeAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`accountNumber` varchar(64) NOT NULL,
	`accountType` varchar(64),
	`nickname` varchar(128),
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tastytradeAccounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `tastytradeAccounts_accountId_unique` UNIQUE(`accountId`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`strategy` enum('csp','cc','pmcc') NOT NULL,
	`action` enum('STO','BTC','BTO','STC') NOT NULL,
	`strike` varchar(20) NOT NULL,
	`expiration` varchar(20) NOT NULL,
	`quantity` int NOT NULL,
	`premium` varchar(20) NOT NULL,
	`orderId` varchar(64),
	`status` enum('pending','filled','cancelled','rejected') NOT NULL DEFAULT 'pending',
	`executedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `watchlists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`strategy` enum('csp','cc','pmcc') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watchlists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `apiCredentials` ADD CONSTRAINT `apiCredentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `positions` ADD CONSTRAINT `positions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `premiumTracking` ADD CONSTRAINT `premiumTracking_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `premiumTracking` ADD CONSTRAINT `premiumTracking_tradeId_trades_id_fk` FOREIGN KEY (`tradeId`) REFERENCES `trades`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tastytradeAccounts` ADD CONSTRAINT `tastytradeAccounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trades` ADD CONSTRAINT `trades_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `watchlists` ADD CONSTRAINT `watchlists_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;