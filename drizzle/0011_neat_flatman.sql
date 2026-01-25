CREATE TABLE `pmccLeapPositions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`strike` varchar(20) NOT NULL,
	`expiration` varchar(20) NOT NULL,
	`quantity` int NOT NULL,
	`purchasePrice` varchar(20) NOT NULL,
	`currentPrice` varchar(20),
	`delta` varchar(10),
	`score` int,
	`availableContracts` int NOT NULL,
	`status` enum('active','closed') NOT NULL DEFAULT 'active',
	`purchasedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pmccLeapPositions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `pmccLeapPositions` ADD CONSTRAINT `pmccLeapPositions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;