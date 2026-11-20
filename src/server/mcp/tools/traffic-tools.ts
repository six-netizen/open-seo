import { z } from "zod";
import { TrafficService } from "@/server/features/traffic/services/TrafficService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  TRAFFIC_DEFAULT_MONTHS,
  TRAFFIC_MAX_MONTHS,
  formatTrafficMonth,
  normalizeTrafficDomain,
  rollUpBrand,
  type TrafficBrand,
} from "@/shared/traffic";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const trafficInputSchema = {
  projectId: projectIdSchema,
  domains: z
    .array(z.string().min(1).max(253))
    .max(100)
    .optional()
    .describe(
      "Limit the answer to these domains. Omit for the project's own domain and all its competitors.",
    ),
  months: z
    .number()
    .int()
    .min(1)
    .max(TRAFFIC_MAX_MONTHS)
    .optional()
    .describe(
      `How many months of history to return (default ${TRAFFIC_DEFAULT_MONTHS}). History only goes back to the first traffic check that was run.`,
    ),
} as const;

type TrafficArgs = z.infer<z.ZodObject<typeof trafficInputSchema>>;

function describeBrand(brand: TrafficBrand): string {
  if (brand.latestVisits == null || brand.latestMonth == null) {
    return brand.domains.some((domain) => domain.status === "not_tracked")
      ? `${brand.name}: not tracked by Similarweb`
      : `${brand.name}: no data yet`;
  }
  const parts = [
    `${brand.name}: ${brand.latestVisits.toLocaleString("en-US")} visits in ${formatTrafficMonth(brand.latestMonth)}`,
  ];
  if (brand.momChangePercent != null) {
    const change = Math.round(brand.momChangePercent * 10) / 10;
    parts.push(`${change > 0 ? "+" : ""}${change}% month over month`);
  }
  if (brand.channels[0]) {
    parts.push(
      `top channel ${brand.channels[0].key} ${Math.round(brand.channels[0].share * 100)}%`,
    );
  }
  if (brand.countries[0]) {
    parts.push(
      `top country ${brand.countries[0].key} ${Math.round(brand.countries[0].share * 100)}%`,
    );
  }
  if (brand.globalRank != null) parts.push(`global rank ${brand.globalRank}`);
  if (brand.domains.length > 1) {
    parts.push(`${brand.domains.length} domains combined`);
  }
  return parts.join(", ");
}

export const getCompetitorTrafficTool = {
  name: "get_competitor_traffic",
  config: {
    title: "Get competitor traffic",
    description:
      "Monthly website traffic for the project's own domain and its competitors: total visits per month, month-over-month change, traffic channels (direct, search, referrals, ...), top countries and global rank. These are Similarweb estimates collected through Apify and stored by OpenSEO, so reading them is free and returns the last stored check, not a live lookup. Domains sharing a competitor name are combined into one brand. A domain Similarweb doesn't track is reported as not tracked, never as zero. To refresh the figures, use run_traffic_check. For search-only traffic and keywords, use get_domain_overview.",
    inputSchema: trafficInputSchema,
    outputSchema: z
      .object({
        configured: z.boolean().optional(),
        lastCompletedAt: z.string().nullable().optional(),
        lastError: z.string().nullable().optional(),
        brands: z.array(z.object({}).passthrough()).optional(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: READ_ANNOTATIONS,
  },
  handler: withMcpProjectAuth(async (args: TrafficArgs, context) => {
    const overview = await TrafficService.getOverview(
      args.projectId,
      args.months,
    );
    const wanted = args.domains
      ? new Set(args.domains.map(normalizeTrafficDomain))
      : null;
    // A filtered brand is re-totalled from the domains that were asked for.
    const brands = wanted
      ? overview.brands.flatMap((brand) => {
          const domains = brand.domains.filter((domain) =>
            wanted.has(domain.domain),
          );
          return domains.length > 0
            ? [rollUpBrand(brand.name, brand.isOwn, domains)]
            : [];
        })
      : overview.brands;

    const text = [
      "Monthly Similarweb traffic estimates (stored snapshots).",
      overview.lastCompletedAt
        ? `Last check completed: ${overview.lastCompletedAt}`
        : "No traffic check has completed yet. Use run_traffic_check to start one.",
      ...(overview.activeRun
        ? ["A traffic check is running now; figures below are from before it."]
        : []),
      ...(overview.lastError
        ? [`The last check failed: ${overview.lastError}`]
        : []),
      ...(overview.configured
        ? []
        : [
            "Traffic checks are not set up on this server (APIFY_API_TOKEN is missing).",
          ]),
      "",
      ...(brands.length > 0
        ? brands.map(describeBrand)
        : [
            wanted
              ? "None of the requested domains is the project's domain or one of its competitors."
              : "The project has no domain and no competitors to track.",
          ]),
    ].join("\n");

    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/traffic`,
      ),
      structuredContent: { ...overview, brands },
    });
  }),
};

const runInputSchema = { projectId: projectIdSchema } as const;

type RunArgs = z.infer<z.ZodObject<typeof runInputSchema>>;

export const runTrafficCheckTool = {
  name: "run_traffic_check",
  config: {
    title: "Run a traffic check",
    description:
      "Start a fresh Similarweb traffic check for the project's own domain and every competitor. It costs a small Apify fee per domain, billed to the server's Apify account, and takes a few minutes: this call returns as soon as the check has started. Call get_competitor_traffic afterwards to read the results. Similarweb data is monthly, so more than one check a month returns the same figures; a check also runs on its own once a month.",
    inputSchema: runInputSchema,
    outputSchema: z
      .object({
        runId: z.string().optional(),
        domainCount: z.number().optional(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: RunArgs, context) => {
    const run = await TrafficService.startRun(args.projectId, "manual");
    return mcpResponse({
      text: `Traffic check started for ${run.domainCount} ${run.domainCount === 1 ? "domain" : "domains"}. Results usually arrive within ten minutes; call get_competitor_traffic to read them.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/traffic`,
      ),
      structuredContent: run,
    });
  }),
};
