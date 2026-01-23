CREATE TABLE `cspFilterPresets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`presetName` enum('conservative','medium','aggressive') NOT NULL,
	`minDte` int NOT NULL DEFAULT 7,
	`maxDte` int NOT NULL DEFAULT 45,
	`minDelta` varchar(10) NOT NULL DEFAULT '0.15',
	`maxDelta` varchar(10) NOT NULL DEFAULT '0.35',
	`minOpenInterest` int NOT NULL DEFAULT 100,
	`minVolume` int NOT NULL DEFAULT 50,
	`minRsi` int DEFAULT 0,
	`maxRsi` int DEFAULT 100,
	`minIvRank` int DEFAULT 0,
	`maxIvRank` int DEFAULT 100,
	`minBbPercent` varchar(10) DEFAULT '0',
	`maxBbPercent` varchar(10) DEFAULT '1',
	`minScore` int NOT NULL DEFAULT 50,
	`maxStrikePercent` int NOT NULL DEFAULT 100,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cspFilterPresets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cspFilterPresets` ADD CONSTRAINT `cspFilterPresets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;