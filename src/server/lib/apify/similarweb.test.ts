import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/fast-similarweb-scraper.json";
import { mapSimilarwebItem, startSimilarwebRun } from "./similarweb";

describe("mapSimilarwebItem", () => {
  it("maps a tracked website", () => {
    const result = mapSimilarwebItem(fixture[0]);

    expect(result.domain).toBe("casoca.com.br");
    expect(result.status).toBe("ok");
    expect(result.monthlyVisits).toEqual([
      { month: "2024-08-01", visits: 473822 },
      { month: "2024-09-01", visits: 466648 },
      { month: "2024-10-01", visits: 545706 },
    ]);
    expect(result.latest?.month).toBe("2024-10-01");
    expect(result.latest?.globalRank).toBe(63367);
    expect(result.latest?.bounceRate).toBeCloseTo(0.276);
    expect(result.latest?.pagesPerVisit).toBeCloseTo(11.56, 2);
    expect(result.latest?.timeOnSiteSeconds).toBeCloseTo(663.9, 1);
    expect(result.latest?.channels[0].key).toBe("search");
    expect(result.latest?.channels[0].share).toBeCloseTo(0.4956);
    expect(
      result.latest?.channels.reduce((sum, c) => sum + c.share, 0),
    ).toBeCloseTo(1, 2);
    expect(result.latest?.countries[0].key).toBe("BR");
    expect(result.latest?.countries[0].share).toBeCloseTo(0.9473);
  });

  it("reports a website with no visit figures as not tracked", () => {
    const withoutVisits = mapSimilarwebItem({
      name: "tiny-mirror.test",
      estimatedMonthlyVisits: {},
    });
    const allZero = mapSimilarwebItem({
      name: "tiny-mirror.test",
      engagements: { visits: 0 },
      estimatedMonthlyVisits: { "2024-09-01": 0, "2024-10-01": 0 },
    });

    const notTracked = {
      domain: "tiny-mirror.test",
      status: "not_tracked",
      monthlyVisits: [],
      latest: null,
    };
    expect(withoutVisits).toEqual(notTracked);
    expect(allZero).toEqual(notTracked);
  });

  it("normalizes the domain, falling back to the Similarweb URL", () => {
    expect(
      mapSimilarwebItem({ ...fixture[0], name: "HTTPS://WWW.Casoca.com.br/" })
        .domain,
    ).toBe("casoca.com.br");
    expect(
      mapSimilarwebItem({
        url: "https://similarweb.com/website/Rival.test/",
        estimatedMonthlyVisits: { "2024-10-01": 10 },
      }).domain,
    ).toBe("rival.test");
  });

  it("rejects a row that names no website", () => {
    expect(() => mapSimilarwebItem({})).toThrow();
  });
});

describe("startSimilarwebRun", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("APIFY_API_TOKEN", "secret-token");
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the token as a header and the websites to check", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: { id: "run_1", status: "READY", defaultDatasetId: "ds_1" },
      }),
    );

    const result = await startSimilarwebRun(["alpha-casino.test"]);

    expect(result).toEqual({ apifyRunId: "run_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.apify.com/v2/acts/tri_angle~fast-similarweb-scraper/runs",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(init?.body).toBe(
      JSON.stringify({ websites: ["alpha-casino.test"] }),
    );
  });

  it("reports a rejected token without leaking it", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));

    const attempt = startSimilarwebRun(["alpha-casino.test"]);

    await expect(attempt).rejects.toMatchObject({ code: "APIFY_AUTH_FAILED" });
    await expect(attempt).rejects.not.toThrow("secret-token");
  });
});
