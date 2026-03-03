CREATE TABLE `app_config` (
	`key` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_config_key` PRIMARY KEY(`key`)
);
