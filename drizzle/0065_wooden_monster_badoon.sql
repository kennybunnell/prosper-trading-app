DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `monthlyIncomeTarget` int DEFAULT 150000 NOT NULL;