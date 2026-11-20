import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { chunk, uniqueBy } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projectCompetitors,
  projects,
  trafficChannelShares,
  trafficCountryShares,
  trafficRuns,
  trafficSnapshots,
} from "@/db/schema";
import type { TrafficDomainResult } from "@/shared/traffic";

// A result writes at most three month rows plus the child rows of its latest
// month. Ten results per batch stays well inside D1's per-batch limits.
const RESULTS_PER_BATCH = 10;

async function getProject(projectId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      brandName: projects.brandName,
      domain: projects.domain,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ?? null;
}

async function getCompetitors(projectId: string) {
  return db
    .select({
      domain: projectCompetitors.domain,
      name: projectCompetitors.name,
    })
    .from(projectCompetitors)
    .where(eq(projectCompetitors.projectId, projectId))
    .orderBy(projectCompetitors.domain);
}

async function listActiveProjectIds(): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.archivedAt));
  return rows.map((row) => row.id);
}

async function insertRun(run: {
  id: string;
  projectId: string;
  trigger: "manual" | "scheduled";
  apifyRunId: string;
  domainCount: number;
  startedAt: string;
}) {
  await db.insert(trafficRuns).values({ ...run, status: "running" });
}

/** A scheduled start the provider rejected, kept so retries are counted. */
async function insertFailedScheduledRun(run: {
  id: string;
  projectId: string;
  error: string;
  startedAt: string;
}) {
  await db.insert(trafficRuns).values({
    ...run,
    trigger: "scheduled",
    status: "failed",
    domainCount: 0,
    finishedAt: run.startedAt,
  });
}

async function getActiveRun(projectId: string) {
  const [run] = await db
    .select({ id: trafficRuns.id, startedAt: trafficRuns.startedAt })
    .from(trafficRuns)
    .where(
      and(
        eq(trafficRuns.projectId, projectId),
        eq(trafficRuns.status, "running"),
      ),
    )
    .orderBy(desc(trafficRuns.startedAt))
    .limit(1);
  return run ?? null;
}

async function listRunningRuns() {
  return db
    .select({
      id: trafficRuns.id,
      projectId: trafficRuns.projectId,
      apifyRunId: trafficRuns.apifyRunId,
      startedAt: trafficRuns.startedAt,
    })
    .from(trafficRuns)
    .where(eq(trafficRuns.status, "running"));
}

async function finishRun(
  id: string,
  outcome: {
    status: "completed" | "failed";
    error: string | null;
    finishedAt: string;
  },
) {
  await db.update(trafficRuns).set(outcome).where(eq(trafficRuns.id, id));
}

/** The latest finished run, and when a run last completed. */
async function getRunSummary(projectId: string) {
  const finished = and(
    eq(trafficRuns.projectId, projectId),
    isNotNull(trafficRuns.finishedAt),
  );
  const [lastFinished] = await db
    .select({ status: trafficRuns.status, error: trafficRuns.error })
    .from(trafficRuns)
    .where(finished)
    .orderBy(desc(trafficRuns.finishedAt))
    .limit(1);
  const [lastCompleted] = await db
    .select({ finishedAt: trafficRuns.finishedAt })
    .from(trafficRuns)
    .where(and(finished, eq(trafficRuns.status, "completed")))
    .orderBy(desc(trafficRuns.finishedAt))
    .limit(1);
  return {
    lastCompletedAt: lastCompleted?.finishedAt ?? null,
    lastError:
      lastFinished?.status === "failed"
        ? (lastFinished.error ?? "The traffic check failed.")
        : null,
  };
}

/** Scheduled runs a project started on or after `since` (an ISO timestamp). */
async function getScheduledRunsSince(projectId: string, since: string) {
  return db
    .select({ status: trafficRuns.status, startedAt: trafficRuns.startedAt })
    .from(trafficRuns)
    .where(
      and(
        eq(trafficRuns.projectId, projectId),
        eq(trafficRuns.trigger, "scheduled"),
        gte(trafficRuns.startedAt, since),
      ),
    );
}

/**
 * Store one run's results. A month the store already holds is updated in
 * place, so a later run corrects the provider's revisions. Rank, engagement
 * and the share rows describe a result's latest month only; older months keep
 * whatever detail they were stored with. A domain the provider doesn't track
 * gets a "not_tracked" row for `dataMonth`, and never replaces real figures.
 */
async function upsertResults(
  projectId: string,
  results: TrafficDomainResult[],
  capturedAt: string,
  dataMonth: string,
) {
  if (results.length === 0) return;
  const existing = await db
    .select({
      id: trafficSnapshots.id,
      domain: trafficSnapshots.domain,
      month: trafficSnapshots.month,
    })
    .from(trafficSnapshots)
    .where(eq(trafficSnapshots.projectId, projectId));
  const existingIds = new Map(
    existing.map((row) => [`${row.domain}|${row.month}`, row.id]),
  );

  for (const batch of chunk(results, RESULTS_PER_BATCH)) {
    await runBatch((tx) =>
      batch.flatMap((result) => {
        const base = { projectId, domain: result.domain, capturedAt };
        const target = [
          trafficSnapshots.projectId,
          trafficSnapshots.domain,
          trafficSnapshots.month,
        ];
        const latest = result.latest;
        if (result.status === "not_tracked" || !latest) {
          return [
            tx
              .insert(trafficSnapshots)
              .values({
                ...base,
                id: crypto.randomUUID(),
                month: dataMonth,
                status: "not_tracked",
              })
              .onConflictDoNothing({ target }),
          ];
        }

        return result.monthlyVisits.flatMap(({ month, visits }) => {
          const id =
            existingIds.get(`${result.domain}|${month}`) ?? crypto.randomUUID();
          if (month !== latest.month) {
            const figures = { status: "ok" as const, visits, capturedAt };
            return [
              tx
                .insert(trafficSnapshots)
                .values({ ...base, id, month, ...figures })
                .onConflictDoUpdate({ target, set: figures }),
            ];
          }

          const figures = {
            status: "ok" as const,
            visits,
            globalRank: latest.globalRank,
            bounceRate: latest.bounceRate,
            pagesPerVisit: latest.pagesPerVisit,
            timeOnSiteSeconds: latest.timeOnSiteSeconds,
            capturedAt,
          };
          const channels = uniqueBy(latest.channels, (entry) => entry.key);
          const countries = uniqueBy(latest.countries, (entry) => entry.key);
          return [
            tx
              .insert(trafficSnapshots)
              .values({ ...base, id, month, ...figures })
              .onConflictDoUpdate({ target, set: figures }),
            tx
              .delete(trafficChannelShares)
              .where(eq(trafficChannelShares.snapshotId, id)),
            tx
              .delete(trafficCountryShares)
              .where(eq(trafficCountryShares.snapshotId, id)),
            ...(channels.length > 0
              ? [
                  tx.insert(trafficChannelShares).values(
                    channels.map((entry) => ({
                      snapshotId: id,
                      channel: entry.key,
                      share: entry.share,
                    })),
                  ),
                ]
              : []),
            ...(countries.length > 0
              ? [
                  tx.insert(trafficCountryShares).values(
                    countries.map((entry) => ({
                      snapshotId: id,
                      countryCode: entry.key,
                      share: entry.share,
                    })),
                  ),
                ]
              : []),
          ];
        });
      }),
    );
  }
}

/** Every snapshot of a project from `sinceMonth` on, with its share rows. */
async function getSnapshotsSince(projectId: string, sinceMonth: string) {
  const inWindow = and(
    eq(trafficSnapshots.projectId, projectId),
    gte(trafficSnapshots.month, sinceMonth),
  );
  const [snapshots, channels, countries] = await Promise.all([
    db
      .select({
        id: trafficSnapshots.id,
        domain: trafficSnapshots.domain,
        month: trafficSnapshots.month,
        status: trafficSnapshots.status,
        visits: trafficSnapshots.visits,
        globalRank: trafficSnapshots.globalRank,
        bounceRate: trafficSnapshots.bounceRate,
        pagesPerVisit: trafficSnapshots.pagesPerVisit,
        timeOnSiteSeconds: trafficSnapshots.timeOnSiteSeconds,
      })
      .from(trafficSnapshots)
      .where(inWindow)
      .orderBy(trafficSnapshots.month),
    db
      .select({
        snapshotId: trafficChannelShares.snapshotId,
        key: trafficChannelShares.channel,
        share: trafficChannelShares.share,
      })
      .from(trafficChannelShares)
      .innerJoin(
        trafficSnapshots,
        eq(trafficSnapshots.id, trafficChannelShares.snapshotId),
      )
      .where(inWindow)
      .orderBy(desc(trafficChannelShares.share)),
    db
      .select({
        snapshotId: trafficCountryShares.snapshotId,
        key: trafficCountryShares.countryCode,
        share: trafficCountryShares.share,
      })
      .from(trafficCountryShares)
      .innerJoin(
        trafficSnapshots,
        eq(trafficSnapshots.id, trafficCountryShares.snapshotId),
      )
      .where(inWindow)
      .orderBy(desc(trafficCountryShares.share)),
  ]);
  return { snapshots, channels, countries };
}

export const TrafficRepository = {
  getProject,
  getCompetitors,
  listActiveProjectIds,
  insertRun,
  insertFailedScheduledRun,
  getActiveRun,
  listRunningRuns,
  finishRun,
  getRunSummary,
  getScheduledRunsSince,
  upsertResults,
  getSnapshotsSince,
};
