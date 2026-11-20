import { sortBy } from "remeda";

// Competitor traffic: monthly Similarweb estimates fetched through an Apify
// actor. Types and pure helpers shared by the server, the page and MCP.

/** A share of visits. `share` is a fraction 0–1. */
export type TrafficShare = { key: string; share: number };

export type TrafficMonthVisits = { month: string; visits: number };

/** The latest month's detail for one domain. */
export type TrafficLatest = {
  /** First day of the month, "YYYY-MM-01". */
  month: string;
  globalRank: number | null;
  /** Fraction 0–1. */
  bounceRate: number | null;
  pagesPerVisit: number | null;
  timeOnSiteSeconds: number | null;
  channels: TrafficShare[];
  /** `key` is an ISO country code. */
  countries: TrafficShare[];
};

/** One domain as the provider reported it in a single run. */
export type TrafficDomainResult = {
  /** Normalized bare host. */
  domain: string;
  status: "ok" | "not_tracked";
  /** Ascending by month. Empty when not tracked. */
  monthlyVisits: TrafficMonthVisits[];
  /** Null when not tracked. */
  latest: TrafficLatest | null;
};

/**
 * Lowercase bare host: no protocol, `www.`, port, path or trailing dot. Lenient
 * on purpose. It matches what project_competitors stores, and a provider row
 * with an unusual TLD must still line up with the domain we asked about.
 */
export function normalizeTrafficDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/** "2026-10-17", "2026-10" or an ISO timestamp → "2026-10-01". Null if not a date. */
export function toTrafficMonth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

/** A run still running this long after it started is treated as failed. */
export const TRAFFIC_RUN_TIMEOUT_MS = 30 * 60_000;
export const TRAFFIC_DEFAULT_MONTHS = 12;
export const TRAFFIC_MAX_MONTHS = 24;
const MAX_BRAND_COUNTRIES = 5;

/**
 * One tracked domain as stored. "no_data" means no run has returned anything
 * for it yet; "not_tracked" means the provider said it publishes no figures.
 */
export type TrafficDomainSeries = {
  domain: string;
  status: "ok" | "not_tracked" | "no_data";
  visitsByMonth: TrafficMonthVisits[];
  latest: TrafficLatest | null;
};

/** One or more domains shown as a single line (a brand and its mirrors). */
export type TrafficBrand = {
  name: string;
  isOwn: boolean;
  domains: TrafficDomainSeries[];
  visitsByMonth: TrafficMonthVisits[];
  latestMonth: string | null;
  latestVisits: number | null;
  momChangePercent: number | null;
  /** Best (lowest) rank across the brand's domains. */
  globalRank: number | null;
  channels: TrafficShare[];
  countries: TrafficShare[];
};

export type TrafficOverview = {
  configured: boolean;
  activeRun: { id: string; startedAt: string } | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  brands: TrafficBrand[];
};

/** "2026-10-01" → "2026-09-01". */
export function previousTrafficMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return monthNumber === 1
    ? `${year - 1}-12-01`
    : `${year}-${String(monthNumber - 1).padStart(2, "0")}-01`;
}

/** First day (UTC) of the month `monthsBack` months before `now`'s month. */
export function trafficMonthsAgo(now: Date, monthsBack: number): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1),
  );
  return date.toISOString().slice(0, 10);
}

// Visit-weighted average of a share across the domains that report the brand's
// latest month. A domain without that month contributes nothing.
function weightedShares(
  domains: TrafficDomainSeries[],
  latestMonth: string,
  pick: (latest: TrafficLatest) => TrafficShare[],
): TrafficShare[] {
  const totals = new Map<string, number>();
  let weight = 0;
  for (const domain of domains) {
    if (domain.latest?.month !== latestMonth) continue;
    const visits =
      domain.visitsByMonth.find((entry) => entry.month === latestMonth)
        ?.visits ?? 0;
    if (visits <= 0) continue;
    weight += visits;
    for (const { key, share } of pick(domain.latest)) {
      totals.set(key, (totals.get(key) ?? 0) + share * visits);
    }
  }
  if (weight === 0) return [];
  return sortBy(
    [...totals].map(([key, total]) => ({ key, share: total / weight })),
    [(entry) => entry.share, "desc"],
  );
}

export function rollUpBrand(
  name: string,
  isOwn: boolean,
  domains: TrafficDomainSeries[],
): TrafficBrand {
  const byMonth = new Map<string, number>();
  for (const domain of domains) {
    for (const { month, visits } of domain.visitsByMonth) {
      byMonth.set(month, (byMonth.get(month) ?? 0) + visits);
    }
  }
  const visitsByMonth = sortBy(
    [...byMonth].map(([month, visits]) => ({ month, visits })),
    (entry) => entry.month,
  );
  const latestMonth = visitsByMonth.at(-1)?.month ?? null;
  const latestVisits = latestMonth ? (byMonth.get(latestMonth) ?? null) : null;
  const previousVisits = latestMonth
    ? byMonth.get(previousTrafficMonth(latestMonth))
    : undefined;
  const ranks = domains.flatMap((domain) =>
    domain.latest?.globalRank == null ? [] : [domain.latest.globalRank],
  );

  return {
    name,
    isOwn,
    domains,
    visitsByMonth,
    latestMonth,
    latestVisits,
    momChangePercent:
      latestVisits != null && previousVisits
        ? ((latestVisits - previousVisits) / previousVisits) * 100
        : null,
    globalRank: ranks.length > 0 ? Math.min(...ranks) : null,
    channels: latestMonth
      ? weightedShares(domains, latestMonth, (latest) => latest.channels)
      : [],
    countries: latestMonth
      ? weightedShares(
          domains,
          latestMonth,
          (latest) => latest.countries,
        ).slice(0, MAX_BRAND_COUNTRIES)
      : [],
  };
}
