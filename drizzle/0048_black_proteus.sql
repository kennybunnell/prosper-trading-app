ALTER TABLE `automationSettings` ADD `ccAutomationEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `automationSettings` ADD `rollEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `automationSettings` ADD `rollDteThreshold` int DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `automationSettings` ADD `rollProfitThreshold` int DEFAULT 50 NOT NULL;