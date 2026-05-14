CREATE TABLE `global_bracket_defaults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`profit_target_pct` int NOT NULL DEFAULT 50,
	`stop_loss_pct` int,
	`dte_floor` int,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `global_bracket_defaults_id` PRIMARY KEY(`id`),
	CONSTRAINT `gbd_user_id_idx` UNIQUE(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `global_bracket_defaults` ADD CONSTRAINT `global_bracket_defaults_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;