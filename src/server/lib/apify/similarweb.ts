import { sortBy } from "remeda";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  normalizeTrafficDomain,
  toTrafficMonth,
  type TrafficDomainResult,
  type TrafficShare,
} from "@/shared/traffic";

// Similarweb's public traffic figures, fetched through an Apify actor that is
// paid per result. The actor is a third-party scraper, not Similarweb's API:
// its output can change, so every row is validated before anything is stored.

const APIFY_API = "https://api.apify.com/v2";
const DEFAULT_ACTOR = "trakk~similarweb-scraper";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COUNTRIES = 5;

async function getToken(): Promise<string | undefined> {
  return getOptionalEnvValue("APIFY_API_TOKEN");
}

export async function isApifyConfigured(): Promise<boolean> {
  return Boolean(await getToken());
}

async function actorId(): Promise<string> {
  const configured = await getOptionalEnvValue("APIFY_SIMILARWEB_ACTOR");
  // Apify's API addresses an actor as "user~name"; people copy "user/name".
  return (configured ?? DEFAULT_ACTOR).replace("/", "~");
}

// The token travels in the Authorization header only, and error messages carry
// the status and path, never the token.
async function apifyRequest(path: string, init: RequestInit = {}) {
  const token = await getToken();
  if (!token) {
    throw new AppError("TRAFFIC_NOT_CONFIGURED", "APIFY_API_TOKEN is not set");
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${APIFY_API}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const failure = new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Apify request failed: ${path}`,
    );
    failure.cause = error;
    throw failure;
  }
  if (
    response.status === 401 ||
    response.status === 402 ||
    response.status === 403
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(
      "APIFY_AUTH_FAILED",
      `Apify answered ${response.status} for ${path}`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Apify answered ${response.status} for ${path}`,
    );
  }
  return response;
}

const runEnvelopeSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    status: z.string(),
    defaultDatasetId: z.string().min(1),
    statusMessage: z.string().nullish(),
  }),
});

export async function startSimilarwebRun(
  domains: string[],
): Promise<{ apifyRunId: string }> {
  const response = await apifyRequest(`/acts/${await actorId()}/runs`, {
    method: "POST",
    body: JSON.stringify({ domains, mode: "base_data" }),
  });
  const run = runEnvelopeSchema.parse(await response.json());
  return { apifyRunId: run.data.id };
}

const RUNNING_STATES = new Set(["READY", "RUNNING", "TIMING-OUT", "ABORTING"]);

export async function getSimilarwebRun(apifyRunId: string): Promise<{
  state: "running" | "succeeded" | "failed";
  datasetId: string;
  message: string | null;
}> {
  const response = await apifyRequest(
    `/actor-runs/${encodeURIComponent(apifyRunId)}`,
  );
  const run = runEnvelopeSchema.parse(await response.json()).data;
  const state = RUNNING_STATES.has(run.status)
    ? "running"
    : run.status === "SUCCEEDED"
      ? "succeeded"
      : "failed";
  return {
    state,
    datasetId: run.defaultDatasetId,
    message:
      state === "failed"
        ? `Apify run ${run.status.toLowerCase()}${run.statusMessage ? `: ${run.statusMessage}` : ""}`
        : null,
  };
}

export async function getSimilarwebItems(
  datasetId: string,
): Promise<unknown[]> {
  const response = await apifyRequest(
    `/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`,
  );
  return z.array(z.unknown()).parse(await response.json());
}

// Only the domain is required. Everything else is optional so one thin row
// (a small site with visits but no engagement data) doesn't fail a whole run.
const itemSchema = z
  .object({
    domain: z.string().min(1),
    status: z.string().nullish(),
    trafficDataAvailable: z.boolean().nullish(),
    globalRank: z.number().nullish(),
    estimatedMonthlyVisits: z.record(z.string(), z.number()).nullish(),
    bounceRatePercent: z.number().nullish(),
    pagesPerVisit: z.number().nullish(),
    timeOnSiteSeconds: z.number().nullish(),
    trafficSources: z.record(z.string(), z.number().nullable()).nullish(),
    topCountryShares: z
      .array(
        z
          .object({ countryCode: z.string().min(1), share: z.number() })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

// A share written on a 0–100 scale is brought down to a 0–1 fraction.
function toFraction(value: number): number {
  return value > 1 ? value / 100 : value;
}

export function mapSimilarwebItem(item: unknown): TrafficDomainResult {
  const row = itemSchema.parse(item);
  const domain = normalizeTrafficDomain(row.domain);
  if (!domain) throw new Error("Similarweb row has an empty domain");

  const monthlyVisits = sortBy(
    Object.entries(row.estimatedMonthlyVisits ?? {}).flatMap(
      ([key, visits]) => {
        const month = toTrafficMonth(key);
        return month ? [{ month, visits: Math.round(visits) }] : [];
      },
    ),
    (entry) => entry.month,
  );

  const tracked =
    row.trafficDataAvailable !== false &&
    row.status !== "not_tracked" &&
    monthlyVisits.length > 0;
  if (!tracked) {
    return { domain, status: "not_tracked", monthlyVisits: [], latest: null };
  }

  const channels: TrafficShare[] = sortBy(
    Object.entries(row.trafficSources ?? {}).flatMap(([key, share]) =>
      share == null ? [] : [{ key, share: toFraction(share) }],
    ),
    [(entry) => entry.share, "desc"],
  );
  const countries: TrafficShare[] = sortBy(
    (row.topCountryShares ?? []).map((country) => ({
      key: country.countryCode.toUpperCase(),
      share: toFraction(country.share),
    })),
    [(entry) => entry.share, "desc"],
  ).slice(0, MAX_COUNTRIES);

  return {
    domain,
    status: "ok",
    monthlyVisits,
    latest: {
      month: monthlyVisits[monthlyVisits.length - 1].month,
      globalRank: row.globalRank ?? null,
      bounceRate:
        row.bounceRatePercent == null ? null : row.bounceRatePercent / 100,
      pagesPerVisit: row.pagesPerVisit ?? null,
      timeOnSiteSeconds: row.timeOnSiteSeconds ?? null,
      channels,
      countries,
    },
  };
}
