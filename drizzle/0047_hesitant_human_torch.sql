ALTER TABLE `automationPendingOrders` MODIFY COLUMN `symbol` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `automationPendingOrders` MODIFY COLUMN `expiration` varchar(64);