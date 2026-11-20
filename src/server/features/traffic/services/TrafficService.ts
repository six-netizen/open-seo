import { groupBy, sortBy } from "remeda";
import { TrafficRepository } from "@/server/features/traffic/repositories/TrafficRepository";
import {
  getSimilarwebItems,
  getSimilarwebRun,
  isApifyConfigured,
  mapSimilarwebItem,
  startSimilarwebRun,
} from "@/server/lib/apify/similarweb";
import { AppError, describeError } from "@/server/lib/errors";
import {
  TRAFFIC_DEFAULT_MONTHS,
  TRAFFIC_MAX_MONTHS,
  TRAFFIC_RUN_TIMEOUT_MS,
  normalizeTrafficDomain,
  rollUpBrand,
  trafficMonthsAgo,
  type TrafficBrand,
  type TrafficDomainResult,
  type TrafficDomainSeries,
  type TrafficOverview,
} from "@/shared/traffic";

type TrackedDomain = { domain: string; brand: string; isOwn: boolean };

// The project's own domain plus its competitors. Competitors sharing a name
// are one brand (a casino and its mirror domains); one without a name is its
// own brand, named by its domain. A competitor row that repeats the project's
// own domain is dropped.
async function getTrackedDomains(projectId: string): Promise<TrackedDomain[]> {
  const project = await TrafficRepository.getProject(projectId);
  if (!project) throw new AppError("NOT_FOUND", "Project not found");
  const tracked = new Map<string, TrackedDomain>();
  const own = project.domain ? normalizeTrafficDomain(project.domain) : "";
  if (own) {
    tracked.set(own, {
      domain: own,
      brand: project.brandName?.trim() || project.name,
      isOwn: true,
    });
  }
  for (const competitor of await TrafficRepository.getCompetitors(projectId)) {
    const domain = normalizeTrafficDomain(competitor.domain);
    if (!domain || tracked.has(domain)) continue;
    tracked.set(domain, {
      domain,
      brand: competitor.name?.trim() || domain,
      isOwn: false,
    });
  }
  return [...tracked.values()];
}

async function startRun(
  projectId: string,
  trigger: "manual" | "scheduled",
  now: Date = new Date(),
): Promise<{ runId: string; domainCount: number }> {
  if (!(await isApifyConfigured())) {
    throw new AppError("TRAFFIC_NOT_CONFIGURED", "APIFY_API_TOKEN is not set");
  }
  const domains = (await getTrackedDomains(projectId)).map(
    (tracked) => tracked.domain,
  );
  if (domains.length === 0) {
    throw new AppError("TRAFFIC_NO_DOMAINS", "No domains to check");
  }
  if (await TrafficRepository.getActiveRun(projectId)) {
    throw new AppError("TRAFFIC_RUN_ACTIVE", "A traffic run is active");
  }

  // The provider is called before the row exists, so a rejected start (bad
  // token, no credit) leaves no "running" run behind.
  const { apifyRunId } = await startSimilarwebRun(domains);
  const runId = crypto.randomUUID();
  await TrafficRepository.insertRun({
    id: runId,
    projectId,
    trigger,
    apifyRunId,
    domainCount: domains.length,
    startedAt: now.toISOString(),
  });
  return { runId, domainCount: domains.length };
}

// The provider's output isn't what the mapper expects. Retrying can't help.
class UnreadableTrafficDataError extends Error {}

function readItem(item: unknown): TrafficDomainResult {
  try {
    return mapSimilarwebItem(item);
  } catch (error) {
    throw new UnreadableTrafficDataError("Unreadable provider row", {
      cause: error,
    });
  }
}

async function storeRunResults(
  projectId: string,
  datasetId: string,
  now: Date,
) {
  const tracked = new Set(
    (await getTrackedDomains(projectId)).map((entry) => entry.domain),
  );
  // One row per tracked domain. The provider can echo a domain twice or
  // return rows for domains nobody asked about; neither is stored.
  const byDomain = new Map<string, TrafficDomainResult>();
  for (const item of await getSimilarwebItems(datasetId)) {
    const result = readItem(item);
    if (tracked.has(result.domain) && !byDomain.has(result.domain)) {
      byDomain.set(result.domain, result);
    }
  }
  const results = [...byDomain.values()];
  const latestMonths = results.flatMap((result) =>
    result.latest ? [result.latest.month] : [],
  );
  // The month an untracked domain is recorded against: the newest month this
  // run reported, or last month when nothing in the run was tracked.
  const dataMonth =
    latestMonths.length > 0
      ? latestMonths.reduce((a, b) => (a > b ? a : b))
      : trafficMonthsAgo(now, 1);
  await TrafficRepository.upsertResults(
    projectId,
    results,
    now.toISOString(),
    dataMonth,
  );
}

/**
 * Called on every scheduled tick: stores the results of runs the provider has
 * finished, and fails runs it failed or that outlived the timeout. One run's
 * trouble never stops the others.
 */
async function collectRunningRuns(now: Date = new Date()): Promise<void> {
  for (const run of await TrafficRepository.listRunningRuns()) {
    const finish = (status: "completed" | "failed", error: string | null) =>
      TrafficRepository.finishRun(run.id, {
        status,
        error,
        finishedAt: now.toISOString(),
      });
    const timedOut =
      now.getTime() - new Date(run.startedAt).getTime() >
      TRAFFIC_RUN_TIMEOUT_MS;
    try {
      if (!run.apifyRunId) {
        await finish("failed", "The run has no provider run to collect.");
        continue;
      }
      const remote = await getSimilarwebRun(run.apifyRunId);
      if (remote.state === "succeeded") {
        await storeRunResults(run.projectId, remote.datasetId, now);
        await finish("completed", null);
      } else if (remote.state === "failed") {
        await finish("failed", remote.message ?? "The provider run failed.");
      } else if (timedOut) {
        await finish("failed", "The traffic check timed out after 30 minutes.");
      }
    } catch (error) {
      console.error("[traffic] collecting run failed:", describeError(error));
      // A transient error is retried on the next tick until the run times
      // out. Data the app can't read never gets better, so that fails now.
      if (error instanceof UnreadableTrafficDataError) {
        await finish(
          "failed",
          "The traffic provider returned data OpenSEO could not read.",
        );
      } else if (timedOut) {
        await finish("failed", "The traffic check timed out after 30 minutes.");
      }
    }
  }
}

async function getOverview(
  projectId: string,
  months: number = TRAFFIC_DEFAULT_MONTHS,
  now: Date = new Date(),
): Promise<TrafficOverview> {
  const window = Math.min(Math.max(Math.trunc(months), 1), TRAFFIC_MAX_MONTHS);
  const [configured, tracked, activeRun, summary, stored] = await Promise.all([
    isApifyConfigured(),
    getTrackedDomains(projectId),
    TrafficRepository.getActiveRun(projectId),
    TrafficRepository.getRunSummary(projectId),
    TrafficRepository.getSnapshotsSince(
      projectId,
      trafficMonthsAgo(now, window),
    ),
  ]);

  const snapshotsByDomain = groupBy(stored.snapshots, (row) => row.domain);
  const channelsBySnapshot = groupBy(stored.channels, (row) => row.snapshotId);
  const countriesBySnapshot = groupBy(
    stored.countries,
    (row) => row.snapshotId,
  );

  const toSeries = (domain: string): TrafficDomainSeries => {
    // Ascending by month, so the last row is the newest.
    const rows = snapshotsByDomain[domain] ?? [];
    const newest = rows.at(-1);
    if (!newest) {
      return { domain, status: "no_data", visitsByMonth: [], latest: null };
    }
    return {
      domain,
      status: newest.status,
      visitsByMonth: rows.flatMap((row) =>
        row.status === "ok" && row.visits != null
          ? [{ month: row.month, visits: row.visits }]
          : [],
      ),
      latest:
        newest.status === "ok"
          ? {
              month: newest.month,
              globalRank: newest.globalRank,
              bounceRate: newest.bounceRate,
              pagesPerVisit: newest.pagesPerVisit,
              timeOnSiteSeconds: newest.timeOnSiteSeconds,
              channels: (channelsBySnapshot[newest.id] ?? []).map(
                ({ key, share }) => ({ key, share }),
              ),
              countries: (countriesBySnapshot[newest.id] ?? []).map(
                ({ key, share }) => ({ key, share }),
              ),
            }
          : null,
    };
  };

  // Own brand first, then competitors by latest visits.
  const groups = new Map<string, TrackedDomain[]>();
  for (const entry of tracked) {
    const key = `${entry.isOwn ? "own" : "competitor"}:${entry.brand.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const brands: TrafficBrand[] = sortBy(
    [...groups.values()].map((entries) =>
      rollUpBrand(
        entries[0].brand,
        entries[0].isOwn,
        entries.map((entry) => toSeries(entry.domain)),
      ),
    ),
    [(brand) => brand.isOwn, "desc"],
    [(brand) => brand.latestVisits ?? -1, "desc"],
    (brand) => brand.name,
  );

  return {
    configured,
    activeRun,
    lastCompletedAt: summary.lastCompletedAt,
    lastError: summary.lastError,
    brands,
  };
}

export const TrafficService = {
  startRun,
  collectRunningRuns,
  getOverview,
};
