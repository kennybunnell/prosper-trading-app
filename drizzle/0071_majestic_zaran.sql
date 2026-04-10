CREATE TABLE `cached_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`account_number` varchar(64) NOT NULL,
	`symbol` varchar(30) NOT NULL,
	`underlying_symbol` varchar(10) NOT NULL,
	`instrument_type` varchar(30) NOT NULL,
	`quantity` varchar(20) NOT NULL,
	`quantity_direction` varchar(10),
	`average_open_price` varchar(20) NOT NULL,
	`close_price` varchar(20),
	`multiplier` int NOT NULL DEFAULT 1,
	`option_type` varchar(5),
	`strike_price` varchar(20),
	`expires_at` varchar(30),
	`synced_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cached_positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `cached_positions_unique` UNIQUE(`user_id`,`account_number`,`symbol`)
);
--> statement-breakpoint
CREATE TABLE `cached_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`account_number` varchar(64) NOT NULL,
	`tastytrade_id` varchar(64) NOT NULL,
	`transaction_type` varchar(50) NOT NULL,
	`transaction_sub_type` varchar(50),
	`action` varchar(50),
	`symbol` varchar(30),
	`underlying_symbol` varchar(10),
	`instrument_type` varchar(30),
	`description` text,
	`value` varchar(20) NOT NULL,
	`net_value` varchar(20),
	`quantity` varchar(20),
	`price` varchar(20),
	`commissions` varchar(20),
	`fees` varchar(20),
	`option_type` varchar(5),
	`strike_price` varchar(20),
	`expires_at` varchar(30),
	`executed_at` timestamp NOT NULL,
	`synced_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cached_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `cached_transactions_unique` UNIQUE(`user_id`,`account_number`,`tastytrade_id`)
);
--> statement-breakpoint
CREATE TABLE `portfolio_sync_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`account_number` varchar(64) NOT NULL,
	`last_positions_sync_at` timestamp,
	`last_transactions_sync_at` timestamp,
	`last_transaction_date` varchar(10),
	`total_transactions_cached` int NOT NULL DEFAULT 0,
	`sync_status` enum('idle','syncing','error') NOT NULL DEFAULT 'idle',
	`last_sync_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `portfolio_sync_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `portfolio_sync_state_unique` UNIQUE(`user_id`,`account_number`)
);
--> statement-breakpoint
ALTER TABLE `cached_positions` ADD CONSTRAINT `cached_positions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cached_transactions` ADD CONSTRAINT `cached_transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `portfolio_sync_state` ADD CONSTRAINT `portfolio_sync_state_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `cached_positions_underlying_idx` ON `cached_positions` (`user_id`,`underlying_symbol`);--> statement-breakpoint
CREATE INDEX `cached_positions_account_idx` ON `cached_positions` (`user_id`,`account_number`);--> statement-breakpoint
CREATE INDEX `cached_transactions_underlying_idx` ON `cached_transactions` (`user_id`,`underlying_symbol`);--> statement-breakpoint
CREATE INDEX `cached_transactions_account_idx` ON `cached_transactions` (`user_id`,`account_number`);--> statement-breakpoint
CREATE INDEX `cached_transactions_executed_at_idx` ON `cached_transactions` (`user_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `portfolio_sync_state_user_idx` ON `portfolio_sync_state` (`user_id`);