CREATE TABLE "traffic_channel_shares" (
	"snapshot_id" text NOT NULL,
	"channel" text NOT NULL,
	"share" real NOT NULL,
	CONSTRAINT "traffic_channel_shares_snapshot_id_channel_pk" PRIMARY KEY("snapshot_id","channel")
);
--> statement-breakpoint
CREATE TABLE "traffic_country_shares" (
	"snapshot_id" text NOT NULL,
	"country_code" text NOT NULL,
	"share" real NOT NULL,
	CONSTRAINT "traffic_country_shares_snapshot_id_country_code_pk" PRIMARY KEY("snapshot_id","country_code")
);
--> statement-breakpoint
CREATE TABLE "traffic_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"apify_run_id" text,
	"domain_count" integer NOT NULL,
	"error" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "traffic_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"month" text NOT NULL,
	"status" text NOT NULL,
	"visits" bigint,
	"global_rank" integer,
	"bounce_rate" real,
	"pages_per_visit" real,
	"time_on_site_seconds" real,
	"captured_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "traffic_channel_shares" ADD CONSTRAINT "traffic_channel_shares_snapshot_id_traffic_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."traffic_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_country_shares" ADD CONSTRAINT "traffic_country_shares_snapshot_id_traffic_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."traffic_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_runs" ADD CONSTRAINT "traffic_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_snapshots" ADD CONSTRAINT "traffic_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "traffic_runs_project_started_idx" ON "traffic_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_snapshots_project_domain_month_idx" ON "traffic_snapshots" USING btree ("project_id","domain","month");