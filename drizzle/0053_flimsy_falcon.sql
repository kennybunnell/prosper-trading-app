CREATE TABLE `snoozed_violations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`symbol` varchar(10) NOT NULL,
	`account_number` varchar(64) NOT NULL,
	`violation_type` varchar(40) NOT NULL,
	`snoozed_until` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `snoozed_violations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `snoozed_violations` ADD CONSTRAINT `snoozed_violations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `snoozed_violations_user_idx` ON `snoozed_violations` (`user_id`);--> statement-breakpoint
CREATE INDEX `snoozed_violations_lookup_idx` ON `snoozed_violations` (`user_id`,`symbol`,`account_number`,`violation_type`);