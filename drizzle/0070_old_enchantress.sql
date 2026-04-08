ALTER TABLE `users` ADD `vipMode` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `vipExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `vipGrantedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `vipGrantedBy` int;