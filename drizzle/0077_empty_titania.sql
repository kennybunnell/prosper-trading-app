CREATE TABLE `auto_close_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`account_id` varchar(64) NOT NULL,
	`account_number` varchar(32) NOT NULL,
	`symbol` varchar(16) NOT NULL,
	`option_symbol` varchar(64) NOT NULL,
	`option_type` enum('C','P') NOT NULL,
	`strike` varchar(16) NOT NULL,
	`expiration` varchar(16) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`open_price` decimal(10,4) NOT NULL,
	`close_price` decimal(10,4) NOT NULL,
	`profit_pct` decimal(6,2) NOT NULL,
	`target_pct` int NOT NULL,
	`order_id` varchar(64),
	`closed_at` bigint NOT NULL,
	`archived` boolean NOT NULL DEFAULT false,
	`archived_at` bigint,
	`notes` text,
	CONSTRAINT `auto_close_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `auto_close_log` ADD CONSTRAINT `auto_close_log_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `acl_user_id_idx` ON `auto_close_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `acl_closed_at_idx` ON `auto_close_log` (`closed_at`);--> statement-breakpoint
CREATE INDEX `acl_archived_idx` ON `auto_close_log` (`archived`);