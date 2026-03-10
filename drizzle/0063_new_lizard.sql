CREATE TABLE `daily_scan_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`scannedAt` timestamp NOT NULL,
	`closeProfitCount` int NOT NULL DEFAULT 0,
	`closeProfitItems` text,
	`rollPositionsCount` int NOT NULL DEFAULT 0,
	`rollPositionsItems` text,
	`sellCallsCount` int NOT NULL DEFAULT 0,
	`sellCallsItems` text,
	`scanSuccess` boolean NOT NULL DEFAULT true,
	`scanError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_scan_cache_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `daily_scan_cache` ADD CONSTRAINT `daily_scan_cache_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;