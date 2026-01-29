CREATE TABLE `watchlistSelections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`isSelected` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `watchlistSelections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `watchlistSelections` ADD CONSTRAINT `watchlistSelections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;