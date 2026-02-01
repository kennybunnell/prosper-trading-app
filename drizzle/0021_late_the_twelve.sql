ALTER TABLE `users` ADD `subscriptionTier` enum('free_trial','wheel','advanced') DEFAULT 'free_trial' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `trialEndsAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeCustomerId` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `stripeSubscriptionId` varchar(255);