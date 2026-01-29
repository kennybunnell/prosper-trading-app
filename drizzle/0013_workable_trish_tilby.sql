ALTER TABLE `positions` ADD `spreadType` enum('bull_put','bear_call','iron_condor');--> statement-breakpoint
ALTER TABLE `positions` ADD `longStrike` varchar(20);--> statement-breakpoint
ALTER TABLE `positions` ADD `spreadWidth` int;--> statement-breakpoint
ALTER TABLE `positions` ADD `capitalAtRisk` varchar(20);