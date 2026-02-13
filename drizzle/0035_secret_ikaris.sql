CREATE TABLE `oauthTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(50) NOT NULL,
	`refreshToken` text NOT NULL,
	`accessToken` text,
	`expiresAt` timestamp,
	`scopes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oauthTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_user_provider` UNIQUE(`userId`,`provider`)
);
--> statement-breakpoint
ALTER TABLE `oauthTokens` ADD CONSTRAINT `oauthTokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `oauthTokens_userId_idx` ON `oauthTokens` (`userId`);