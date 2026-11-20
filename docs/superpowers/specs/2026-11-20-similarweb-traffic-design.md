# Competitor traffic in OpenSEO (Similarweb data via Apify) — design

Date: 2026-11-20 · Status: awaiting approval · Base: every-app/open-seo @ af3f995 (v0.1.31)

Lines marked **(my call)** were decided by Claude, not by S. Correct any of them.

## Intent

S runs BarbossaBet and wants to track casino competitors' traffic in one self-hosted, open-source tool, paying only for data used. OpenSEO covers the search side through DataForSEO. It has no total-traffic data: visits, channel mix, countries. This adds that, using Similarweb's public figures fetched through a pay-per-result Apify actor, because Similarweb's own API is sales-led with monthly credits.

## Goals

- A **Traffic** page per project showing the project's own domain and its competitors: monthly visits, month-over-month change, channel mix, top countries, global rank, engagement.
- History that grows over time. The actor returns only the last three months per run, so every run is stored and trends come from the store.
- Brands with several domains (mirrors) roll up into one line.
- The same data available to Claude through OpenSEO's MCP server.
- A monthly automatic refresh plus a manual one.
- Runs on the standalone Docker stack on S's server.

## Non-goals

- Referring-site / affiliate lists. The actor's referrer data is "frequently unavailable"; only the referral share is stored.
- Similarweb top keywords. OpenSEO already has better keyword data from DataForSEO. **(my call)**
- Hosted-mode billing, credits or metering. Self-host only. **(my call)**
- Sub-monthly data. Similarweb's public data is monthly.
- Contributing the feature upstream. Possible later; not planned for. **(my call)**

## Anti-goals

- No invented numbers. Missing months stay missing; no interpolation. A domain Similarweb doesn't track shows "Not tracked", never zero.
- A broken or changed actor must not break the rest of OpenSEO. The run fails visibly; stored history stays readable.
- The fork must stay cheap to merge with upstream. Upstream ships daily.

## Constraints found in the codebase

- Layering rule (AGENTS.md): TanStack server function → service → repository. Zod at trust boundaries.
- Every schema change must exist for both SQLite (`src/db/*.schema.ts`) and Postgres (`src/db/pg/*.schema.ts`); `schema-parity.test.ts` enforces it. The standalone Docker stack runs SQLite (`DATABASE_PROVIDER: "d1"`).
- Relational data stays normalized, not stuffed into JSON columns.
- Competitors already exist: `project_competitors` (projectId, domain, name, notes), unique per project+domain. The project's own domain is `projects.domain`.
- Scheduled work: the standalone stack calls the Worker's `scheduled` handler every 5 minutes with a 150-second request timeout (`scripts/selfhost-scheduler.mjs`). Handlers are dispatched in `src/server.ts`.
- Secrets reach the standalone runtime only if named in the allowlist in `scripts/celld/runtime/configure.mjs` and passed in `deploy/standalone/compose.yaml`.
- Outside hosted mode, spend metering is a pass-through (`researchSpend.ts`), so no billing work is needed.
- Charts use `recharts`; tables use `@tanstack/react-table`. Nav lives in `src/client/navigation/items.ts`. MCP tools are registered in `src/server/mcp/server.ts` and covered by an output-schema contract test.
- A second data provider already has precedent: `src/serverFunctions/ahrefs.ts`.

## Approaches considered

1. **Native feature in a fork (picked by S).** One UI, one MCP server, data next to the SEO data. Costs: own image build, upstream merges.
2. **Sidecar: n8n → Postgres → Metabase.** No fork. Rejected by S: second UI, not in OpenSEO's MCP.
3. **Similarweb's official API.** Dropped: no self-serve API access, sales contract, monthly credits that don't roll over.
4. **DataForSEO traffic estimates only.** Dropped: search traffic only, and most casino traffic is direct, affiliate and email.

## Design

### Data source

- Apify actor `trakk/similarweb-scraper`, mode `base_data`. Chosen for usage (131 monthly active users at time of writing), free rows for untracked domains, and ten-channel breakdown. **(my call)**
- Env: `APIFY_API_TOKEN` (required for the feature), `APIFY_SIMILARWEB_ACTOR` (default `trakk~similarweb-scraper`).
- The actor ID is swappable, but the output mapper is written for this actor. A different actor needs its own mapper.
- New module `src/server/lib/apify/similarweb.ts`: start a run, read run status, read dataset items. Actor output is validated with Zod; a row that fails validation fails the run with a clear message rather than storing partial garbage.
- Without a token the Traffic page shows a setup hint, like the existing DataForSEO/OpenRouter help pages. Nothing else changes.

### Run model

A run is asynchronous, because a batch can outlast the 150-second scheduler request.

1. **Start:** insert a `traffic_runs` row (`running`), call Apify to start the actor with all domains, store the Apify run ID.
2. **Collect:** the existing 5-minute tick checks `running` runs. When Apify reports success, fetch the dataset, upsert snapshots, mark `completed`. On Apify failure or after 30 minutes, mark `failed` with the reason. **(my call on 30 minutes)**
3. One active run per project at a time.
4. A failed scheduled run is retried on the next day, at most three times in a month. **(my call)**

Server functions use the existing `requireProjectContext` middleware; MCP tools use `withMcpProjectAuth`. A project with no own domain and no competitors has nothing to run.

Manual refresh and the monthly schedule both use this path. The page polls run status while one is running.

**Schedule:** monthly, first tick on or after the 12th, once per project per calendar month, only for projects with a token configured and at least one domain. The 12th is after Similarweb usually publishes the previous month. **(my call)**

### What gets tracked

The project's own domain plus every row in `project_competitors`. No new competitor list.

**Brand roll-up:** domains sharing the same `project_competitors.name` are one brand; the page sums their visits and weights shares by visits. A domain with no name is its own brand. This handles mirror domains without a schema change to competitors. **(my call)**

### Data model (new file `traffic.schema.ts`, SQLite + Postgres)

- `traffic_runs`: id, projectId, status (`running|completed|failed`), trigger (`manual|scheduled`), apifyRunId, domainCount, error, startedAt, finishedAt.
- `traffic_snapshots`: id, projectId, domain, month (first day of the data month), status (`ok|not_tracked`), visits, globalRank, bounceRate, pagesPerVisit, timeOnSiteSeconds, capturedAt. Unique on (projectId, domain, month).
- `traffic_channel_shares`: snapshotId, channel, share (0–1).
- `traffic_country_shares`: snapshotId, countryCode, share (0–1).

Each run returns three months of visits per domain. All three are upserted, so a later run corrects Similarweb's revisions. Engagement, rank, channels and countries describe the latest month only and are written to that month's row.

### Page: `/p/$projectId/traffic`

Nav item "Traffic", after "Domain Overview". **(my call)**

```
Traffic                         Last updated 12 Nov · [Refresh]
Similarweb estimates via Apify. Monthly. Small sites may be untracked.

[ Visits over time — one line per brand, up to 24 months ]

Brand          Visits (Oct)   MoM     Top channel   Top country   Global rank
BarbossaBet    …              …       …             …             …
Competitor A   …  (3 domains) …       …             …             …
Competitor B   Not tracked

[ Channel mix — one stacked bar per brand ]
[ Countries — top 5 for the selected brand ]
```

Expanding a brand shows its domains individually. Empty state points to adding competitors.

### MCP tools

- `get_competitor_traffic` — read-only. projectId, optional domains, optional months (default 12). Returns stored snapshots per brand and domain, with the snapshot date.
- `run_traffic_check` — starts a run for the project, returns the run ID and domain count. Says results arrive within minutes and to call `get_competitor_traffic` after.

### Deployment

- Fork under S's GitHub; work on a feature branch; additive files wherever possible.
- Shared files touched, and only these: schema index files, a generated migration per dialect, `src/server.ts` (one line in the tick), `src/server/mcp/server.ts`, `navigation/items.ts`, `configure.mjs` allowlist, standalone `compose.yaml` and `.env.example`, the generated route tree.
- Build the image from the fork with `deploy/standalone/Dockerfile`; run the standalone compose stack with `OPENSEO_IMAGE` pointing at it.
- `AUTH_MODE=password`, HTTPS reverse proxy in front, `BETTER_AUTH_URL` set to the public origin.

### Testing

Per the repo's rule of few, behavior-level tests:

- Mapper: a real actor sample → snapshots, including a `not_tracked` domain and a schema-invalid row.
- Service: re-running a month upserts rather than duplicates; brand roll-up sums and weights correctly.
- MCP output-schema contract and schema-parity tests pass.

## Left to the builder

- First step: run the actor once on 3–5 casino domains and save the real output as the test fixture. The field names in this doc come from the actor's listing page, not from a live run.
- Exact channel names and whether shares arrive 0–1 or 0–100 (the listing shows both forms).
- Run-status polling interval in the UI, chart styling, column formatting.
- Whether the monthly check lives in its own service file or beside the rank-check scheduler.

## Risks

- The actor is an unofficial scraper. It can break or change output when Similarweb changes its site. Mitigation: strict validation, visible failures, swappable actor.
- Similarweb's public figures are modelled estimates and are weak for small sites. The page says so.
- Upstream churn. Mitigation: additive change, small list of touched shared files, pin the base commit and merge deliberately.

## Answers from S (2026-11-20)

1. Server: the Orbitra server, which has 40 GB of storage. Hostname: `seo.sixwizz.com`.
2. Source: `https://github.com/every-app/open-seo`. That is upstream, so a fork under S's GitHub is still needed for the branch and the image build.
3. Apify: S has a key. DataForSEO: account being created; not needed for the Traffic feature.

Implementation plan: `similarweb-traffic-plan.md`.
