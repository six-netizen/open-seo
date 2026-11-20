import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/trakk-base-data.json";
import { mapSimilarwebItem, startSimilarwebRun } from "./similarweb";

describe("mapSimilarwebItem", () => {
  it("maps a tracked domain", () => {
    const result = mapSimilarwebItem(fixture[0]);

    expect(result.domain).toBe("alpha-casino.test");
    expect(result.status).toBe("ok");
    expect(result.monthlyVisits).toEqual([
      { month: "2026-08-01", visits: 220000 },
      { month: "2026-09-01", visits: 238000 },
      { month: "2026-10-01", visits: 245000 },
    ]);
    expect(result.latest?.month).toBe("2026-10-01");
    expect(result.latest?.globalRank).toBe(18420);
    expect(result.latest?.bounceRate).toBeCloseTo(0.412);
    const channels = result.latest?.channels ?? [];
    expect(channels.every((c) => c.share >= 0 && c.share <= 1)).toBe(true);
    expect(channels.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1, 1);
    expect(result.latest?.countries[0]).toEqual({ key: "DE", share: 0.41 });
    expect(result.latest?.countries.length).toBeLessThanOrEqual(5);
  });

  it("maps an untracked domain without inventing visits", () => {
    const result = mapSimilarwebItem(fixture[2]);

    expect(result).toEqual({
      domain: "tiny-mirror.test",
      status: "not_tracked",
      monthlyVisits: [],
      latest: null,
    });
  });

  it("normalizes the domain", () => {
    const result = mapSimilarwebItem({
      ...fixture[1],
      domain: "HTTPS://WWW.Beta-Bet.test/",
    });

    expect(result.domain).toBe("beta-bet.test");
  });

  it("rejects a row missing its domain", () => {
    expect(() => mapSimilarwebItem({})).toThrow();
  });
});

describe("startSimilarwebRun", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("APIFY_API_TOKEN", "secret-token");
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the token as a header and asks for base data", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: { id: "run_1", status: "READY", defaultDatasetId: "ds_1" },
      }),
    );

    const result = await startSimilarwebRun(["alpha-casino.test"]);

    expect(result).toEqual({ apifyRunId: "run_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.apify.com/v2/acts/trakk~similarweb-scraper/runs",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(init?.body).toBe(
      JSON.stringify({ domains: ["alpha-casino.test"], mode: "base_data" }),
    );
  });

  it("reports a rejected token without leaking it", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));

    const attempt = startSimilarwebRun(["alpha-casino.test"]);

    await expect(attempt).rejects.toMatchObject({ code: "APIFY_AUTH_FAILED" });
    await expect(attempt).rejects.not.toThrow("secret-token");
  });
});
