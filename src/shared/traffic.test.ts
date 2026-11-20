import { describe, expect, it } from "vitest";
import { rollUpBrand, type TrafficDomainSeries } from "./traffic";

function series(
  domain: string,
  visitsByMonth: Record<string, number>,
  directShare: number,
): TrafficDomainSeries {
  const months = Object.keys(visitsByMonth);
  return {
    domain,
    status: "ok",
    visitsByMonth: months.map((month) => ({
      month,
      visits: visitsByMonth[month],
    })),
    latest: {
      month: months[months.length - 1],
      globalRank: null,
      bounceRate: null,
      pagesPerVisit: null,
      timeOnSiteSeconds: null,
      channels: [
        { key: "direct", share: directShare },
        { key: "organicSearch", share: 1 - directShare },
      ],
      countries: [],
    },
  };
}

describe("rollUpBrand", () => {
  it("sums visits and weights shares by visits", () => {
    const brand = rollUpBrand("Alpha", false, [
      series("alpha.test", { "2026-10-01": 300 }, 0.5),
      series("alpha-mirror.test", { "2026-10-01": 100 }, 0.1),
    ]);

    expect(brand.latestMonth).toBe("2026-10-01");
    expect(brand.latestVisits).toBe(400);
    expect(brand.channels[0].key).toBe("organicSearch");
    expect(
      brand.channels.find((channel) => channel.key === "direct")?.share,
    ).toBeCloseTo(0.4);
  });

  it("reports month-over-month change against the previous month", () => {
    const brand = rollUpBrand("Alpha", false, [
      series("alpha.test", { "2026-09-01": 200, "2026-10-01": 300 }, 0.5),
    ]);

    expect(brand.momChangePercent).toBeCloseTo(50);
  });

  it("returns no month-over-month change without a previous month", () => {
    const brand = rollUpBrand("Alpha", false, [
      series("alpha.test", { "2026-08-01": 200, "2026-10-01": 300 }, 0.5),
    ]);

    expect(brand.momChangePercent).toBeNull();
  });
});
