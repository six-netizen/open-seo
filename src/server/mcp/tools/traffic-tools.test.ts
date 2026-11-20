import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { rollUpBrand, type TrafficOverview } from "@/shared/traffic";
import { makeToolContext, textContent } from "./tool-test-support";
import { getCompetitorTrafficTool } from "./traffic-tools";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getOverview: vi.fn<() => Promise<TrafficOverview>>(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/traffic/services/TrafficService", () => ({
  TrafficService: { getOverview: mocks.getOverview },
}));

const projectId = "11111111-1111-4111-8111-111111111111";

function run(args: Record<string, unknown> = {}) {
  const parsed = z
    .object(getCompetitorTrafficTool.config.inputSchema)
    .parse({ projectId, ...args });
  return getCompetitorTrafficTool.handler(parsed, makeToolContext());
}

describe("get_competitor_traffic", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: projectId });
    mocks.getOverview.mockResolvedValue({
      configured: true,
      activeRun: null,
      lastCompletedAt: "2026-11-12T08:05:00.000Z",
      lastError: null,
      brands: [
        rollUpBrand("Own Brand", true, [
          {
            domain: "own.test",
            status: "ok",
            visitsByMonth: [{ month: "2026-10-01", visits: 1000 }],
            latest: null,
          },
        ]),
        rollUpBrand("Rival", false, [
          {
            domain: "rival.test",
            status: "ok",
            visitsByMonth: [{ month: "2026-10-01", visits: 300 }],
            latest: null,
          },
          {
            domain: "rival-mirror.test",
            status: "ok",
            visitsByMonth: [{ month: "2026-10-01", visits: 100 }],
            latest: null,
          },
        ]),
        rollUpBrand("Tiny", false, [
          {
            domain: "tiny.test",
            status: "not_tracked",
            visitsByMonth: [],
            latest: null,
          },
        ]),
      ],
    });
  });

  it("returns only the requested domains, re-totalled", async () => {
    const result = await run({ domains: ["https://WWW.Rival.test/"] });

    const brands = result.structuredContent.brands;
    expect(brands.map((brand) => brand.name)).toEqual(["Rival"]);
    expect(brands[0].domains.map((domain) => domain.domain)).toEqual([
      "rival.test",
    ]);
    expect(brands[0].latestVisits).toBe(300);
  });

  it("says a domain is not tracked instead of reporting zero visits", async () => {
    const text = textContent(await run());

    expect(text).toContain("Tiny: not tracked by Similarweb");
    expect(text).toContain("Rival: 400 visits in Oct 2026");
  });
});
