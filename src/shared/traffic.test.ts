import { describe, expect, it } from "vitest";
import {
  isScheduledTrafficRunDue,
  rollUpBrand,
  type TrafficDomainSeries,
} from "./traffic";

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

const on = (iso: string) => new Date(iso);

describe("isScheduledTrafficRunDue", () => {
  const idle = {
    hasRunningRun: false,
    completedScheduledThisMonth: false,
    failedScheduledThisMonth: 0,
    lastScheduledStartedAt: null,
  };
  it("waits for the 12th of the month", () => {
    expect(
      isScheduledTrafficRunDue({ ...idle, now: on("2026-11-11T23:59:00Z") }),
    ).toBe(false);
    expect(
      isScheduledTrafficRunDue({ ...idle, now: on("2026-11-12T00:00:00Z") }),
    ).toBe(true);
  });

  it("runs once a month", () => {
    expect(
      isScheduledTrafficRunDue({
        ...idle,
        now: on("2026-11-20T10:00:00Z"),
        completedScheduledThisMonth: true,
      }),
    ).toBe(false);
  });

  it("does not start while a run is active", () => {
    expect(
      isScheduledTrafficRunDue({
        ...idle,
        now: on("2026-11-20T10:00:00Z"),
        hasRunningRun: true,
      }),
    ).toBe(false);
  });

  it("retries a failure a day later, at most three times a month", () => {
    const now = on("2026-11-20T10:00:00Z");
    const failedOnce = { ...idle, now, failedScheduledThisMonth: 1 };

    expect(
      isScheduledTrafficRunDue({
        ...failedOnce,
        lastScheduledStartedAt: on("2026-11-20T08:00:00Z"),
      }),
    ).toBe(false);
    expect(
      isScheduledTrafficRunDue({
        ...failedOnce,
        lastScheduledStartedAt: on("2026-11-19T09:00:00Z"),
      }),
    ).toBe(true);
    expect(
      isScheduledTrafficRunDue({
        ...failedOnce,
        failedScheduledThisMonth: 3,
        lastScheduledStartedAt: on("2026-11-15T09:00:00Z"),
      }),
    ).toBe(false);
  });
});
