CREATE TABLE `chatConversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`subject` varchar(255) NOT NULL,
	`status` enum('active','resolved','needs_admin') NOT NULL DEFAULT 'active',
	`hasAdminReplied` boolean NOT NULL DEFAULT false,
	`lastMessageAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chatConversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`senderId` int,
	`senderType` enum('user','ai','admin') NOT NULL,
	`message` text NOT NULL,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chatMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chatConversations` ADD CONSTRAINT `chatConversations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD CONSTRAINT `chatMessages_conversationId_chatConversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `chatConversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD CONSTRAINT `chatMessages_senderId_users_id_fk` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chatConversations_userId_idx` ON `chatConversations` (`userId`);--> statement-breakpoint
CREATE INDEX `chatConversations_status_idx` ON `chatConversations` (`status`);--> statement-breakpoint
CREATE INDEX `chatConversations_lastMessageAt_idx` ON `chatConversations` (`lastMessageAt`);--> statement-breakpoint
CREATE INDEX `chatMessages_conversationId_idx` ON `chatMessages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `chatMessages_createdAt_idx` ON `chatMessages` (`createdAt`);