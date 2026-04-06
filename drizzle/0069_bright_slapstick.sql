CREATE TABLE `submittedRolls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`positionId` varchar(200) NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`strategy` varchar(10) NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`newExpiration` varchar(20),
	`newStrike` varchar(20),
	`netCredit` varchar(20),
	`rolledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `submittedRolls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `submittedRolls` ADD CONSTRAINT `submittedRolls_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `submittedRolls_userId_idx` ON `submittedRolls` (`userId`);--> statement-breakpoint
CREATE INDEX `submittedRolls_positionId_date_idx` ON `submittedRolls` (`positionId`,`rolledAt`);