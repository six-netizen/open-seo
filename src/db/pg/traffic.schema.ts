import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// Postgres twin of ../traffic.schema.ts; see the comments there. Timestamps
// are text, as in pg/app.schema.ts.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const trafficRuns = pgTable(
  "traffic_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    apifyRunId: text("apify_run_id"),
    domainCount: integer("domain_count").notNull(),
    error: text("error"),
    startedAt: text("started_at").notNull().default(isoNow),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("traffic_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);

export const trafficSnapshots = pgTable(
  "traffic_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    month: text("month").notNull(),
    status: text("status", { enum: ["ok", "not_tracked"] }).notNull(),
    visits: bigint("visits", { mode: "number" }),
    globalRank: integer("global_rank"),
    bounceRate: real("bounce_rate"),
    pagesPerVisit: real("pages_per_visit"),
    timeOnSiteSeconds: real("time_on_site_seconds"),
    capturedAt: text("captured_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("traffic_snapshots_project_domain_month_idx").on(
      table.projectId,
      table.domain,
      table.month,
    ),
  ],
);

export const trafficChannelShares = pgTable(
  "traffic_channel_shares",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => trafficSnapshots.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    share: real("share").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.channel] })],
);

export const trafficCountryShares = pgTable(
  "traffic_country_shares",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => trafficSnapshots.id, { onDelete: "cascade" }),
    countryCode: text("country_code").notNull(),
    share: real("share").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.countryCode] })],
);
