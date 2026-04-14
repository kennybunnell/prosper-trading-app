CREATE TABLE `trading_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`option_symbol` varchar(64),
	`account_number` varchar(64),
	`strategy` varchar(32) NOT NULL,
	`action` varchar(16) NOT NULL,
	`strike` varchar(20),
	`expiration` varchar(20),
	`quantity` int,
	`price` varchar(20),
	`price_effect` varchar(16),
	`instrument_type` varchar(32),
	`outcome` enum('success','rejected','error','dry_run') NOT NULL,
	`order_id` varchar(64),
	`error_message` text,
	`error_payload` text,
	`ai_diagnosis` text,
	`source` varchar(64),
	`is_dry_run` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trading_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `trading_log` ADD CONSTRAINT `trading_log_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `trading_log_user_idx` ON `trading_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `trading_log_outcome_idx` ON `trading_log` (`outcome`);--> statement-breakpoint
CREATE INDEX `trading_log_created_at_idx` ON `trading_log` (`created_at`);