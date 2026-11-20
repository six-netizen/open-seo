CREATE TABLE `traffic_channel_shares` (
	`snapshot_id` text NOT NULL,
	`channel` text NOT NULL,
	`share` real NOT NULL,
	PRIMARY KEY(`snapshot_id`, `channel`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `traffic_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `traffic_country_shares` (
	`snapshot_id` text NOT NULL,
	`country_code` text NOT NULL,
	`share` real NOT NULL,
	PRIMARY KEY(`snapshot_id`, `country_code`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `traffic_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `traffic_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`trigger` text NOT NULL,
	`apify_run_id` text,
	`domain_count` integer NOT NULL,
	`error` text,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `traffic_runs_project_started_idx` ON `traffic_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `traffic_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`month` text NOT NULL,
	`status` text NOT NULL,
	`visits` integer,
	`global_rank` integer,
	`bounce_rate` real,
	`pages_per_visit` real,
	`time_on_site_seconds` real,
	`captured_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `traffic_snapshots_project_domain_month_idx` ON `traffic_snapshots` (`project_id`,`domain`,`month`);