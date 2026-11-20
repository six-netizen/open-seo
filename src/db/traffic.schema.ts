import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Competitor traffic: monthly Similarweb estimates fetched through an Apify
// actor. A run asks the actor about every tracked domain of a project; each
// result is stored as one snapshot per (project, domain, month), so history
// grows beyond the three months a single run returns.
// ============================================================================

export const trafficRuns = sqliteTable(
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
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("traffic_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);

export const trafficSnapshots = sqliteTable(
  "traffic_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Normalized bare host, matching project_competitors.domain.
    domain: text("domain").notNull(),
    // First day of the month the figures describe, "YYYY-MM-01".
    month: text("month").notNull(),
    // "not_tracked" means Similarweb publishes nothing for the domain. It is
    // never stored as zero visits.
    status: text("status", { enum: ["ok", "not_tracked"] }).notNull(),
    visits: integer("visits"),
    globalRank: integer("global_rank"),
    // Fraction 0–1.
    bounceRate: real("bounce_rate"),
    pagesPerVisit: real("pages_per_visit"),
    timeOnSiteSeconds: real("time_on_site_seconds"),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("traffic_snapshots_project_domain_month_idx").on(
      table.projectId,
      table.domain,
      table.month,
    ),
  ],
);

// Share of a snapshot's visits per channel (direct, organic search, ...), as a
// fraction 0–1.
export const trafficChannelShares = sqliteTable(
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

// Share of a snapshot's visits per country (ISO code), as a fraction 0–1.
export const trafficCountryShares = sqliteTable(
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
