-- Rename table from cspFilterPresets to filterPresets
RENAME TABLE `cspFilterPresets` TO `filterPresets`;
--> statement-breakpoint
-- Add strategy column with default value 'csp' for existing rows
ALTER TABLE `filterPresets` ADD COLUMN `strategy` enum('csp','cc','pmcc') NOT NULL DEFAULT 'csp' AFTER `userId`;
