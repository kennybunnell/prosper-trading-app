ALTER TABLE `filterPresets` MODIFY COLUMN `strategy` enum('csp','cc','pmcc','bps','bcs') NOT NULL;--> statement-breakpoint
ALTER TABLE `premiumTracking` MODIFY COLUMN `strategy` enum('csp','cc','pmcc','bps','bcs') NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `strategy` enum('csp','cc','pmcc','bps','bcs') NOT NULL;--> statement-breakpoint
ALTER TABLE `watchlists` MODIFY COLUMN `strategy` enum('csp','cc','pmcc','bps','bcs') NOT NULL;