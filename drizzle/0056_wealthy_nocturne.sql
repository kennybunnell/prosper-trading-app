CREATE TABLE `liquidation_flags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`account_number` varchar(64) NOT NULL,
	`flagged_at` timestamp NOT NULL DEFAULT (now()),
	`note` varchar(255),
	CONSTRAINT `liquidation_flags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `liquidation_flags` ADD CONSTRAINT `liquidation_flags_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `liquidation_flags_user_idx` ON `liquidation_flags` (`user_id`);--> statement-breakpoint
CREATE INDEX `liquidation_flags_lookup_idx` ON `liquidation_flags` (`user_id`,`symbol`,`account_number`);