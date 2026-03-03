CREATE TABLE `wtr_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`account_number` varchar(64) NOT NULL,
	`scan_date` varchar(10) NOT NULL,
	`scanned_at` bigint NOT NULL,
	`weeks_to_recover` varchar(20),
	`recommendation` enum('KEEP','HARVEST','MONITOR','LIQUIDATE') NOT NULL,
	`avg_cost_basis` varchar(20) NOT NULL,
	`current_price` varchar(20) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wtr_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `wtr_history` ADD CONSTRAINT `wtr_history_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `wtr_history_user_symbol_account_idx` ON `wtr_history` (`user_id`,`symbol`,`account_number`);--> statement-breakpoint
CREATE INDEX `wtr_history_user_scan_date_idx` ON `wtr_history` (`user_id`,`scan_date`);--> statement-breakpoint
CREATE INDEX `wtr_history_scanned_at_idx` ON `wtr_history` (`scanned_at`);