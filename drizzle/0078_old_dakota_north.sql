ALTER TABLE `auto_close_log` ADD `close_reason` varchar(32);--> statement-breakpoint
ALTER TABLE `positionTargets` ADD `stopLossPct` int;--> statement-breakpoint
ALTER TABLE `positionTargets` ADD `dteFloor` int;--> statement-breakpoint
ALTER TABLE `positionTargets` ADD `closeReason` varchar(20);