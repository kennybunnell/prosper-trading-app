ALTER TABLE `users` ADD `acceptedTermsAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `acceptedRiskDisclosureAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `acceptedTermsIp` varchar(45);