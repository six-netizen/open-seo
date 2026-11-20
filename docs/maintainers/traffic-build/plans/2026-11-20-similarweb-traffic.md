# Competitor Traffic (Similarweb via Apify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project Traffic page and two MCP tools to a fork of OpenSEO that store and show monthly Similarweb traffic estimates for the project's own domain and its competitors, fetched through an Apify actor.

**Architecture:** A new `traffic` feature following the repo's server function → service → repository layering. Runs are asynchronous: starting a run creates a `traffic_runs` row and an Apify actor run; the existing 5-minute scheduled tick collects finished runs and upserts normalized monthly snapshots. Everything is additive except a short list of shared files.

**Tech Stack:** TypeScript, TanStack Start/Router/Query, Drizzle (SQLite + Postgres schemas), Zod, Vitest, recharts, the MCP server in `src/server/mcp`, Docker standalone stack (`deploy/standalone`).

**Spec:** `docs/maintainers/traffic-build/specs/2026-11-20-similarweb-traffic-design.md`

## Global Constraints

- Base: `every-app/open-seo` @ `af3f995` (v0.1.31). Work on branch `feature/similarweb-traffic` in the fork.
- Layering: TanStack server function → service → repository. Zod at trust boundaries. Read `AGENTS.md` before writing code or tests.
- Every table exists in both `src/db/traffic.schema.ts` (SQLite) and `src/db/pg/traffic.schema.ts` (Postgres); `src/db/schema-parity.test.ts` must pass.
- No JSON columns for relational data.
- No invented numbers: no interpolation; an untracked domain is `not_tracked`, never `0`.
- Env names, exactly: `APIFY_API_TOKEN`, `APIFY_SIMILARWEB_ACTOR` (default `trakk~similarweb-scraper`).
- Actor input, exactly: `{ "domains": [...], "mode": "base_data" }`.
- A run still `running` 30 minutes after `startedAt` is marked `failed`.
- Scheduled run: first tick on or after the 12th (UTC) of each month, once per project per month, at most 3 failed attempts per month, at least 24 hours apart.
- Shares are stored as fractions 0–1. Months are stored as `YYYY-MM-01`.
- Shared upstream files that may be modified, and no others: `src/db/schema.ts`, `src/server.ts`, `src/server/mcp/server.ts`, `src/client/navigation/items.ts`, `scripts/celld/runtime/configure.mjs`, `deploy/standalone/compose.yaml`, `deploy/standalone/.env.example`, generated `src/routeTree.gen.ts`, generated files under `drizzle/`.
- Tests follow `AGENTS.md`: few, behavior-level, through public entry points, no ORM chain mocks. Repository behavior is tested with real SQL the way `RankTrackingRepository.query.test.ts` does.
- Self-host only. Do not touch billing, credits or hosted-mode code.

## Review Focus

1. **Apify rejects the start call** (bad token, 401/402). Expected: `startRun` throws a clear error and leaves no `running` row behind. → Task 3.
2. **A run never finishes.** Expected: marked `failed` with reason "timed out" after 30 minutes; a new run can then start. → Task 3.
3. **Domain spelling differs** between what we send and what the actor returns (`www.`, protocol, case). Expected: rows match on the normalized host. → Task 2.
4. **The actor returns fewer rows than requested.** Expected: the run completes; missing domains simply have no snapshot for that run and show "No data". → Task 3.
5. **No DataForSEO key is set.** Expected: the Traffic page and both MCP tools still work; only the SEO features ask for the key. → Task 5.

## File Structure

Create:

- `src/shared/traffic.ts` — shared types and pure helpers (month math, roll-up, due check).
- `src/db/traffic.schema.ts`, `src/db/pg/traffic.schema.ts` — four tables.
- `src/server/lib/apify/similarweb.ts` — Apify HTTP calls and the actor-row mapper.
- `src/server/lib/apify/__fixtures__/trakk-base-data.json` — real actor output (Task 0).
- `src/server/features/traffic/repositories/TrafficRepository.ts`
- `src/server/features/traffic/services/TrafficService.ts`
- `src/server/features/traffic/services/scheduledTrafficChecks.ts`
- `src/serverFunctions/traffic.ts`
- `src/routes/_app/p/$projectId/traffic.tsx`
- `src/client/features/traffic/TrafficPage.tsx`, `TrafficVisitsChart.tsx`, `TrafficBrandsTable.tsx`, `TrafficChannelMix.tsx`
- `src/server/mcp/tools/traffic-tools.ts`
- `.github/workflows/fork-image.yml`
- `docs/SELF_HOSTING_TRAFFIC.md`

---

### Task 0: Capture a real actor sample (needs S)

The field names in the spec come from the actor's listing page. Nothing downstream is trustworthy until a real sample exists. Apify is not reachable from the build sandbox, so S runs this.

- [ ] **Step 1:** In the Apify Console, run `trakk/similarweb-scraper` with input `{"domains": [<4 real casino domains>, <1 small mirror domain likely untracked>], "mode": "base_data"}`.
- [ ] **Step 2:** Export the dataset as JSON and save it unchanged as `src/server/lib/apify/__fixtures__/trakk-base-data.json`.
- [ ] **Step 3:** Record in the spec's "Left to the builder" section: the exact channel keys, whether `trafficSources` values are 0–1, the status value for an untracked domain, and the keys holding monthly visits, countries, rank and engagement.

Deliverable: the fixture file committed, spec notes updated.

### Task 1: Schema and migrations

**Files:**

- Create: `src/db/traffic.schema.ts`, `src/db/pg/traffic.schema.ts`
- Modify: `src/db/schema.ts` (import both, add to `AppSchema`, both runtime spreads, and the export list)
- Generated: `drizzle/sqlite/*`, `drizzle/pg/*`

**Interfaces — Produces** (exported from `@/db/schema`):

| Table                                             | Columns                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trafficRuns` (`traffic_runs`)                    | `id` text PK · `projectId` → projects, cascade · `status` enum `running\|completed\|failed` · `trigger` enum `manual\|scheduled` · `apifyRunId` text null · `domainCount` int · `error` text null · `startedAt` text default now · `finishedAt` text null. Index (`projectId`, `startedAt`).                                              |
| `trafficSnapshots` (`traffic_snapshots`)          | `id` text PK · `projectId` → projects, cascade · `domain` text · `month` text · `status` enum `ok\|not_tracked` · `visits` int null (bigint in PG) · `globalRank` int null · `bounceRate` real null · `pagesPerVisit` real null · `timeOnSiteSeconds` real null · `capturedAt` text default now. Unique (`projectId`, `domain`, `month`). |
| `trafficChannelShares` (`traffic_channel_shares`) | `snapshotId` → trafficSnapshots, cascade · `channel` text · `share` real. PK (`snapshotId`, `channel`).                                                                                                                                                                                                                                   |
| `trafficCountryShares` (`traffic_country_shares`) | `snapshotId` → trafficSnapshots, cascade · `countryCode` text · `share` real. PK (`snapshotId`, `countryCode`).                                                                                                                                                                                                                           |

- [ ] **Step 1:** Write both schema files, mirroring the column helpers used by `backlinkSnapshots` in each dialect (`timestampColumn`/`isoNow` in PG).
- [ ] **Step 2:** Wire them into `src/db/schema.ts`.
- [ ] **Step 3:** Run `pnpm db:generate`. Confirm the SQLite migration contains only `CREATE TABLE`/`CREATE INDEX` and no `__new_` rebuild.
- [ ] **Step 4:** Run `pnpm vitest run src/db/schema-parity.test.ts src/db/sqliteMigrations.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(traffic): add traffic tables`.

### Task 2: Apify client and actor mapper

**Files:**

- Create: `src/shared/traffic.ts`, `src/server/lib/apify/similarweb.ts`
- Test: `src/server/lib/apify/similarweb.test.ts`

**Interfaces — Consumes:** fixture from Task 0; `normalizeDomainInput` from `@/server/lib/domainUtils`; `getOptionalEnvValue` from `@/server/lib/runtime-env`.

**Interfaces — Produces:**

```ts
// src/shared/traffic.ts
export type TrafficShare = { key: string; share: number }; // share 0–1
export type TrafficDomainResult = {
  domain: string; // normalized host
  status: "ok" | "not_tracked";
  monthlyVisits: { month: string; visits: number }[]; // month "YYYY-MM-01", ascending
  latest: {
    month: string;
    globalRank: number | null;
    bounceRate: number | null; // 0–1
    pagesPerVisit: number | null;
    timeOnSiteSeconds: number | null;
    channels: TrafficShare[];
    countries: TrafficShare[]; // key = ISO country code
  } | null; // null when not_tracked
};

// src/server/lib/apify/similarweb.ts
export async function isApifyConfigured(): Promise<boolean>;
export async function startSimilarwebRun(
  domains: string[],
): Promise<{ apifyRunId: string }>;
export async function getSimilarwebRun(apifyRunId: string): Promise<{
  state: "running" | "succeeded" | "failed";
  datasetId: string;
  message: string | null;
}>;
export async function getSimilarwebItems(datasetId: string): Promise<unknown[]>;
export function mapSimilarwebItem(item: unknown): TrafficDomainResult; // throws on invalid row
```

Apify endpoints (verify against docs.apify.com/api/v2 before coding): `POST /v2/acts/{actor}/runs`, `GET /v2/actor-runs/{runId}`, `GET /v2/datasets/{datasetId}/items?clean=true&format=json`. Auth is `Authorization: Bearer <token>`, never a query parameter. Apify states `READY`/`RUNNING`/`TIMING-OUT`/`ABORTING` map to `running`; `SUCCEEDED` to `succeeded`; everything else to `failed`.

- [ ] **Step 1: Write failing mapper tests** against the fixture:
  - `maps a tracked domain`: `status === "ok"`, `monthlyVisits` has 3 ascending months in `YYYY-MM-01` form, `latest.month` equals the last of them, channel shares each within 0–1 and summing to 1 ± 0.02, `countries.length <= 5`.
  - `maps an untracked domain`: `status === "not_tracked"`, `monthlyVisits` is `[]`, `latest === null`.
  - `normalizes the domain`: an item whose domain is `HTTPS://WWW.Example.com/` maps to `example.com`.
  - `rejects a row missing its domain`: `mapSimilarwebItem({})` throws.
- [ ] **Step 2:** Run `pnpm vitest run src/server/lib/apify/similarweb.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `src/shared/traffic.ts` types and `mapSimilarwebItem` with a Zod schema built from the fixture's real keys. Percent-scale inputs (0–100) are divided by 100 on the way in.
- [ ] **Step 4:** Implement the four HTTP functions with `fetch`, a 30-second timeout each, and errors that include the HTTP status but never the token.
- [ ] **Step 5:** Run the tests. Expected: PASS. Run `pnpm types:check`.
- [ ] **Step 6:** Commit `feat(traffic): apify similarweb client and mapper`.

### Task 3: Repository and service

**Files:**

- Create: `src/server/features/traffic/repositories/TrafficRepository.ts`, `src/server/features/traffic/services/TrafficService.ts`
- Modify: `src/shared/traffic.ts` (overview types, `rollUpBrand`)
- Test: `src/server/features/traffic/services/TrafficService.test.ts`, `src/shared/traffic.test.ts`

**Interfaces — Consumes:** Task 1 tables; Task 2 functions; `projects`, `projectCompetitors` from `@/db/schema`; `runBatch` from `@/db/runBatch`.

**Interfaces — Produces:**

```ts
// src/shared/traffic.ts
export const TRAFFIC_RUN_TIMEOUT_MS = 30 * 60_000;
export type TrafficDomainSeries = {
  domain: string;
  status: "ok" | "not_tracked" | "no_data";
  visitsByMonth: { month: string; visits: number }[];
  latest: TrafficDomainResult["latest"];
};
export type TrafficBrand = {
  name: string;
  isOwn: boolean;
  domains: TrafficDomainSeries[];
  visitsByMonth: { month: string; visits: number }[];
  latestMonth: string | null;
  latestVisits: number | null;
  momChangePercent: number | null;
  globalRank: number | null; // best (lowest) across domains
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
export function rollUpBrand(name: string, isOwn: boolean, domains: TrafficDomainSeries[]): TrafficBrand;

// TrafficService
startRun(projectId: string, trigger: "manual" | "scheduled"): Promise<{ runId: string; domainCount: number }>;
collectRunningRuns(now: Date): Promise<void>;
getOverview(projectId: string, months?: number): Promise<TrafficOverview>; // default 12, max 24
```

`startRun` error codes, thrown through the repo's existing app-error helper in `@/server/lib/errors`: `TRAFFIC_NOT_CONFIGURED`, `TRAFFIC_NO_DOMAINS`, `TRAFFIC_RUN_ACTIVE`.

Rules the tests pin:

- Tracked domains = `projects.domain` (if set) plus every `project_competitors.domain`, normalized and de-duplicated.
- Brands: the own domain is one brand named `projects.brandName ?? projects.name` with `isOwn: true`. Competitor rows sharing a non-empty `name` form one brand; a row without a name is a brand named by its domain.
- Brand visits per month = sum over its domains that have that month. Brand `latestMonth` = the newest month any of its domains has.
- Brand share = Σ(shareᵈ × visitsᵈ) ÷ Σ visitsᵈ over domains with `latest` in `latestMonth`; then top 5 countries.
- `momChangePercent` = (latest − previous) ÷ previous × 100, `null` when the previous month is missing or 0.
- Upsert: for each result, every month in `monthlyVisits` upserts a snapshot row on (`projectId`, `domain`, `month`); `latest` fields and child share rows are replaced only on the `latest.month` row. A `not_tracked` result writes one row for the current data month with `status: "not_tracked"` and null metrics.

- [ ] **Step 1: Write failing tests.**
  - `traffic.test.ts` → `rollUpBrand sums visits and weights shares`: two domains, 300 and 100 visits, direct share 0.5 and 0.1 → brand `latestVisits === 400`, direct share `0.4`.
  - `rollUpBrand returns null MoM without a previous month`.
  - `TrafficService.test.ts` → `collecting the same month twice updates rather than duplicates`: collect a run with visits 1000 for 2026-10, then another with 1200 → one row, visits 1200, one set of channel rows.
  - `start failure leaves no running row`: `startSimilarwebRun` mocked to reject → `startRun` rejects and `getOverview().activeRun === null`. (Review Focus 1)
  - `a run older than 30 minutes fails as timed out`. (Review Focus 2)
  - `a run completes when the actor omits a domain`: 2 requested, 1 returned → run `completed`, missing domain has `status: "no_data"` in the overview. (Review Focus 4)
  - `a second start while one is running is rejected with TRAFFIC_RUN_ACTIVE`.
- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Implement `rollUpBrand` in `src/shared/traffic.ts`.
- [ ] **Step 4:** Implement `TrafficRepository` (run insert/complete/fail, `getActiveRun`, `listRunningRuns`, `upsertResults` via `runBatch`, `getSnapshotsSince`, `getTrackedDomains`, `countScheduledRunsInMonth`).
- [ ] **Step 5:** Implement `TrafficService`. `startRun` calls Apify first and inserts the `running` row only after Apify returns a run ID.
- [ ] **Step 6:** Run the tests. Expected: PASS. Run `pnpm types:check && pnpm lint`.
- [ ] **Step 7:** Commit `feat(traffic): run lifecycle, snapshot store and brand roll-up`.

### Task 4: Scheduled collection and monthly runs

**Files:**

- Create: `src/server/features/traffic/services/scheduledTrafficChecks.ts`
- Modify: `src/server.ts` (add one entry to the `Promise.allSettled` list in the `*/5` branch, beside `runScheduledRankChecks`), `src/shared/traffic.ts`
- Test: `src/shared/traffic.test.ts`

**Interfaces — Consumes:** `TrafficService.startRun`, `TrafficService.collectRunningRuns`, `isApifyConfigured`.

**Interfaces — Produces:**

```ts
// src/shared/traffic.ts
export function isScheduledTrafficRunDue(input: {
  now: Date;
  hasRunningRun: boolean;
  completedScheduledThisMonth: boolean;
  failedScheduledThisMonth: number;
  lastScheduledStartedAt: Date | null;
}): boolean;

// scheduledTrafficChecks.ts
export async function runScheduledTrafficChecks(now?: Date): Promise<void>;
```

`runScheduledTrafficChecks`: return immediately when Apify is not configured; otherwise `collectRunningRuns(now)`, then start a `scheduled` run for each non-archived project that is due. One project's failure is logged and does not stop the others.

- [ ] **Step 1: Write failing tests** for `isScheduledTrafficRunDue`:
  - 11th of the month → `false`. 12th, nothing run yet → `true`.
  - already completed this month → `false`. A run is running → `false`.
  - 3 failures this month → `false`. 1 failure 2 hours ago → `false`; 1 failure 25 hours ago → `true`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the function and the scheduler; add the tick entry wrapped in `withPgClient` like its neighbors.
- [ ] **Step 4:** Run the tests and `pnpm types:check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(traffic): monthly scheduled runs and collection on the tick`.

### Task 5: Server functions and Traffic page

**Files:**

- Create: `src/serverFunctions/traffic.ts`, `src/routes/_app/p/$projectId/traffic.tsx`, the four files under `src/client/features/traffic/`
- Modify: `src/client/navigation/items.ts` (item `{ to: "/p/$projectId/traffic", label: "Traffic", icon: BarChart3 }` directly after "Domain Overview")

**Interfaces — Consumes:** `TrafficService`, `TrafficOverview`, `requireProjectContext` from `@/serverFunctions/middleware`.

**Interfaces — Produces:** `getTrafficOverview({ projectId, months? })` and `startTrafficRun({ projectId })` server functions.

Page behavior:

- Header: title, "Last updated <date>", a Refresh button (disabled while a run is active), and the note `Similarweb estimates via Apify. Monthly. Small sites may be untracked.`
- Not configured → setup card naming `APIFY_API_TOKEN` and linking `docs/SELF_HOSTING_TRAFFIC.md`. No domains → empty state linking the project's competitor settings.
- Visits chart: recharts line chart, one line per brand, own brand first.
- Brands table (`@tanstack/react-table`): Brand · Visits (latest month) · MoM · Top channel · Top country · Global rank. Multi-domain brands show "(n domains)" and expand to per-domain rows. `not_tracked` shows "Not tracked"; `no_data` shows "No data".
- Channel mix: one stacked horizontal bar per brand. Countries: top 5 for the selected brand.
- While `activeRun` is set, refetch the overview every 10 seconds; show `lastError` in an alert when the last run failed.

- [ ] **Step 1:** Implement the two server functions with Zod validators.
- [ ] **Step 2:** Build the route and components, reusing existing page, table and alert components from `src/client/components/ui/` and the layout used by `src/client/features/backlinks/BacklinksPage.tsx`.
- [ ] **Step 3:** Add the nav item. Run `pnpm build` so `src/routeTree.gen.ts` regenerates.
- [ ] **Step 4: Verify in the browser.** Run `pnpm dev` with `APIFY_API_TOKEN` set and **no** `DATAFORSEO_API_KEY`. Load the fixture into the store through `TrafficService` for a project with competitors. Confirm: the page renders chart, table, channel mix and countries; a multi-domain brand expands; the untracked fixture domain reads "Not tracked"; the page is reachable without a DataForSEO key (Review Focus 5). Save a screenshot for the handover.
- [ ] **Step 5:** Run `pnpm types:check && pnpm lint && pnpm knip`. Expected: clean.
- [ ] **Step 6:** Commit `feat(traffic): traffic page and navigation`.

### Task 6: MCP tools

**Files:**

- Create: `src/server/mcp/tools/traffic-tools.ts`
- Modify: `src/server/mcp/server.ts` (import and `register(...)` both, beside `getDomainOverviewTool`)
- Test: `src/server/mcp/tools/traffic-tools.test.ts`

**Interfaces — Produces:**

- `getCompetitorTrafficTool` — name `get_competitor_traffic`; input `projectId`, `domains?: string[]`, `months?: number` (1–24, default 12); read-only annotations; returns `TrafficOverview` filtered to the given domains. Description says the data is monthly Similarweb estimates, comes from the stored snapshots, and costs nothing to read.
- `runTrafficCheckTool` — name `run_traffic_check`; input `projectId`; returns `{ runId, domainCount }` and a message that results arrive within minutes and to call `get_competitor_traffic` afterwards.

Both use `withMcpProjectAuth`, `mcpResponse`, `buildProjectMeta`, and a `.passthrough()` output schema, as `get-domain-overview.ts` does.

- [ ] **Step 1: Write a failing test** using the helpers in `tool-test-support.ts`: `get_competitor_traffic filters to the requested domains` — overview with two brands, request one domain, result contains only that brand.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and register both tools.
- [ ] **Step 4:** Run `pnpm vitest run src/server/mcp`. Expected: PASS, including `output-schema-contract.test.ts`.
- [ ] **Step 5:** Commit `feat(traffic): mcp tools for competitor traffic`.

### Task 7: Standalone packaging and fork image

**Files:**

- Modify: `scripts/celld/runtime/configure.mjs` (add both env names to `allowed`), `deploy/standalone/compose.yaml` (pass both to `init`), `deploy/standalone/.env.example`
- Create: `.github/workflows/fork-image.yml`, `docs/SELF_HOSTING_TRAFFIC.md`

`fork-image.yml`: on push to `main` and `feature/similarweb-traffic`, and `workflow_dispatch`; skips when `github.repository == 'every-app/open-seo'`; builds `deploy/standalone/Dockerfile` for `linux/amd64` only; pushes `ghcr.io/${{ github.repository_owner }}/open-seo-standalone` tagged `latest` on main and `sha-<short>` always. Pin actions to the same SHAs `docker-image.yml` uses.

- [ ] **Step 1:** Make the three config edits and write the workflow and doc (what the feature does, the two env vars, cost note, the unofficial-scraper caveat, how to add competitors and name mirrors).
- [ ] **Step 2:** Run `pnpm build:standalone`. Expected: succeeds.
- [ ] **Step 3:** Run `pnpm test:ci && pnpm types:check && pnpm lint && pnpm format:check`. Expected: all pass.
- [ ] **Step 4:** Commit `feat(traffic): standalone env passthrough and fork image workflow`. Push the branch; confirm the workflow publishes the image.

### Task 8: Deploy to the Orbitra server at seo.sixwizz.com (S runs server commands)

No SSH access exists from the build environment, so this is a runbook S executes; each step has a check.

- [ ] **Step 1: Capacity.** `df -h /` shows at least 8 GB free; `free -h` shows at least 4 GB total memory with 2 GB available. If not, stop and pick another server: the runtime container is limited to 2 GB and the docs ask for 4 GB for Docker.
- [ ] **Step 2: DNS.** `seo.sixwizz.com` A record → the server's IP. Check: `dig +short seo.sixwizz.com`.
- [ ] **Step 3: Stack.** Install Docker Engine + Compose if absent. In `/opt/openseo`, place `deploy/standalone/compose.yaml` and a `.env` from `.env.example` with: `STORAGE_SECRET_KEY=$(openssl rand -hex 32)`, `BETTER_AUTH_URL=https://seo.sixwizz.com`, `OPENSEO_IMAGE=ghcr.io/<owner>/open-seo-standalone:latest`, `APIFY_API_TOKEN=<token>`. Leave `DATAFORSEO_API_KEY` empty until the account exists. `chmod 600 .env`.
- [ ] **Step 4: Start.** `docker compose pull && docker compose up -d && docker compose logs -f init` until `OpenSEO initialized and ready.` Check: `curl -fsS http://127.0.0.1:3001/api/health`.
- [ ] **Step 5: Reverse proxy.** Add an nginx server block for `seo.sixwizz.com` proxying to `127.0.0.1:3001` (with `Upgrade`/`Connection` headers and `proxy_read_timeout 300s`), then `certbot --nginx -d seo.sixwizz.com`. Do not touch the Orbitra vhost or `/var/www/orbitra` ownership.
- [ ] **Step 6: First account.** Open `https://seo.sixwizz.com` and create the administrator account immediately; registration closes after it.
- [ ] **Step 7: Smoke test.** Create the BarbossaBet project, add 3 competitors, press Refresh on Traffic, and confirm rows appear within about 10 minutes.
- [ ] **Step 8: MCP.** Connect Claude to the instance's MCP endpoint and call `get_competitor_traffic`.
- [ ] **Step 9:** When the DataForSEO account exists, add `DATAFORSEO_API_KEY` to `.env` and run `docker compose up -d --force-recreate init web crawl-gateway`.
