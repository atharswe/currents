CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`guid` text NOT NULL,
	`url` text,
	`title` text NOT NULL,
	`author` text,
	`summary` text,
	`content` text,
	`published_at` integer,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_feed_guid_unique` ON `articles` (`feed_id`,`guid`);--> statement-breakpoint
CREATE INDEX `articles_published_at_idx` ON `articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `articles_feed_read_idx` ON `articles` (`feed_id`,`is_read`);--> statement-breakpoint
CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_url` text NOT NULL,
	`title` text NOT NULL,
	`site_url` text,
	`description` text,
	`folder` text DEFAULT 'Unsorted' NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_fetched_at` integer,
	`last_error` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_feed_url_unique` ON `feeds` (`feed_url`);