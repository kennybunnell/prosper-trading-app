CREATE TABLE `orderHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`underlyingSymbol` varchar(10) NOT NULL,
	`action` varchar(20) NOT NULL,
	`strategy` varchar(50),
	`strike` varchar(20) NOT NULL,
	`expiration` varchar(20) NOT NULL,
	`quantity` int NOT NULL,
	`submittedPrice` varchar(20) NOT NULL,
	`finalPrice` varchar(20),
	`submittedAt` timestamp NOT NULL,
	`filledAt` timestamp,
	`canceledAt` timestamp,
	`replacementCount` int NOT NULL DEFAULT 0,
	`fillDurationMinutes` int,
	`wasAutoCanceled` int NOT NULL DEFAULT 0,
	`status` enum('working','filled','canceled','rejected') NOT NULL DEFAULT 'working',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orderHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `orderHistory` ADD CONSTRAINT `orderHistory_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;