ALTER TABLE `automationPendingOrders` MODIFY COLUMN `orderType` enum('close_position','open_covered_call','close_spread') NOT NULL;--> statement-breakpoint
ALTER TABLE `automationPendingOrders` ADD `spreadLongSymbol` varchar(64);--> statement-breakpoint
ALTER TABLE `automationPendingOrders` ADD `spreadLongStrike` varchar(20);--> statement-breakpoint
ALTER TABLE `automationPendingOrders` ADD `spreadLongPrice` varchar(20);