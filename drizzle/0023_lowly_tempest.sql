ALTER TABLE `tastytradeAccounts` DROP COLUMN `isDemoAccount`;--> statement-breakpoint
ALTER TABLE `tastytradeAccounts` DROP COLUMN `demoBalance`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `subscriptionTier`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `trialEndsAt`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `stripeCustomerId`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `stripeSubscriptionId`;