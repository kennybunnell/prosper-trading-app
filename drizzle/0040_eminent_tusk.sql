ALTER TABLE `apiCredentials` ADD `tradierAccountBalance` varchar(20);--> statement-breakpoint
ALTER TABLE `apiCredentials` ADD `tradierAccountStatus` varchar(50);--> statement-breakpoint
ALTER TABLE `apiCredentials` ADD `tradierBuyingPower` varchar(20);--> statement-breakpoint
ALTER TABLE `apiCredentials` ADD `tradierLastHealthCheck` timestamp;