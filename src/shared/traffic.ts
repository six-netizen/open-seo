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
