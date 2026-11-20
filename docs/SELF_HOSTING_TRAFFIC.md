# Competitor traffic (Similarweb through Apify)

The **Traffic** page shows monthly website traffic for a project's own domain and its competitors: total visits, month-over-month change, traffic channels, top countries and global rank. The same data is available to AI agents through the `get_competitor_traffic` and `run_traffic_check` MCP tools.

This feature is an addition in this fork. It is not part of upstream OpenSEO.

## Where the numbers come from

The figures are Similarweb's public estimates, fetched by a third-party [Apify](https://apify.com) actor ([`trakk/similarweb-scraper`](https://apify.com/trakk/similarweb-scraper)). Know what that means before you rely on them:

- They are modelled estimates, not measurements, and are weakest for small sites.
- The actor is an unofficial scraper, not Similarweb's API. It can change or stop working. When it does, traffic checks fail with a message on the Traffic page and the history already stored stays readable.
- Similarweb publishes monthly data. A check returns the last three months, so longer history exists only from the first check you ran onward.
- A site Similarweb doesn't track is shown as "Not tracked", never as zero visits.
- Referring sites and affiliate lists are not collected. Only the share of visits arriving by referral is.

## Set up

1. Create an Apify account and copy an API token from **Settings → API & Integrations**.
2. Set it in `deploy/standalone/.env`:

   ```sh
   APIFY_API_TOKEN=apify_api_...
   ```

3. Apply it:

   ```sh
   docker compose up -d --force-recreate init web crawl-gateway
   ```

`APIFY_SIMILARWEB_ACTOR` is optional and defaults to `trakk~similarweb-scraper`. The data mapping is written for that actor's output; another actor needs its own mapping in `src/server/lib/apify/similarweb.ts`.

DataForSEO is not needed for the Traffic page.

## Choose what is tracked

Traffic is tracked for the project's own domain and every competitor saved in the project's **Context**. There is no separate list.

Competitors that share the same name are combined into one brand, which is how a casino and its mirror domains show as a single line. Expand the brand on the Traffic page to see each domain.

## When checks run

- **Refresh** on the Traffic page, or the `run_traffic_check` MCP tool, starts a check now. Results arrive within a few minutes.
- A check also runs on its own once a month, from the 12th (UTC), after Similarweb has usually published the previous month. A failed monthly check is retried a day later, up to three times that month.

Running more than one check a month returns the same monthly figures.

## Cost

Apify bills the actor per domain checked. At the actor's listed price of about $1.50 per 1,000 domains, 50 domains checked monthly costs well under $1 a month. Domains Similarweb doesn't track are not billed as results. Check the actor's Pricing tab for current rates.

## Building the image for a fork

`.github/workflows/fork-image.yml` builds the standalone image and pushes it to `ghcr.io/<owner>/open-seo-standalone`. Enable GitHub Actions on the fork first; forks have them off by default. Point the stack at the image in `deploy/standalone/.env`:

```sh
OPENSEO_IMAGE=ghcr.io/<owner>/open-seo-standalone:latest
```

A package pushed to a personal account starts private. Either make it public in the package's settings, or run `docker login ghcr.io` on the server with a token that has `read:packages`.
