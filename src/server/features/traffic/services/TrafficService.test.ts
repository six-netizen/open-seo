import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as TrafficServiceModule from "./TrafficService";

// Real in-memory SQLite, created from the shipped migration, so the upsert and
// the run lifecycle run against actual SQL. Only the Apify HTTP calls are
// replaced.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

const apify = vi.hoisted(() => ({
  isApifyConfigured: vi.fn<() => Promise<boolean>>(),
  startSimilarwebRun: vi.fn<() => Promise<{ apifyRunId: string }>>(),
  getSimilarwebRun: vi.fn(),
  getSimilarwebItems: vi.fn<() => Promise<unknown[]>>(),
}));

vi.mock("@/server/lib/apify/similarweb", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...apify,
}));

let client: Client;
let testDb: ReturnType<typeof drizzle>;
let TrafficService: typeof TrafficServiceModule.TrafficService;

const START = new Date("2026-11-12T08:00:00.000Z");
const minutesLater = (minutes: number) =>
  new Date(START.getTime() + minutes * 60_000);

function item(domain: string, october: number) {
  return {
    domain,
    status: "ok",
    globalRank: 5000,
    estimatedMonthlyVisits: {
      "2026-09-01": 900,
      "2026-10-01": october,
    },
    trafficSources: { direct: 0.6, organicSearch: 0.4 },
    topCountryShares: [{ countryCode: "DE", share: 1 }],
  };
}

async function count(sql: string): Promise<number> {
  const result = await client.execute(sql);
  return Number(result.rows[0][0]);
}

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  // Run batched writes one by one against the same in-memory database.
  vi.doMock("@/db/runBatch", () => ({
    DB_BATCH_SIZE: 100,
    runBatch: async (
      build: (tx: typeof testDb) => readonly Promise<unknown>[],
    ) => {
      for (const statement of build(testDb)) await statement;
    },
  }));

  await client.executeMultiple(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand_name TEXT,
      domain TEXT,
      archived_at TEXT
    );
    CREATE TABLE project_competitors (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      name TEXT
    );
  `);
  const migration = readFileSync("drizzle/sqlite/0074_traffic.sql", "utf8");
  await client.executeMultiple(
    migration.replaceAll("--> statement-breakpoint", ""),
  );

  // Module under test is imported after doMock so it binds to the test db.
  ({ TrafficService } = await import("./TrafficService"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM traffic_channel_shares;
    DELETE FROM traffic_country_shares;
    DELETE FROM traffic_snapshots;
    DELETE FROM traffic_runs;
    DELETE FROM project_competitors;
    DELETE FROM projects;
    INSERT INTO projects (id, organization_id, name, domain)
      VALUES ('p1', 'org1', 'Own Brand', 'own.test');
    INSERT INTO project_competitors (id, project_id, domain, name)
      VALUES ('c1', 'p1', 'rival.test', 'Rival');
  `);
  apify.isApifyConfigured.mockResolvedValue(true);
  apify.startSimilarwebRun.mockResolvedValue({ apifyRunId: "run_1" });
  apify.getSimilarwebRun.mockResolvedValue({
    state: "succeeded",
    datasetId: "ds_1",
    message: null,
  });
  apify.getSimilarwebItems.mockResolvedValue([
    item("own.test", 1000),
    item("rival.test", 500),
  ]);
});

describe("TrafficService", () => {
  it("asks the provider about the project's own domain and its competitors", async () => {
    const started = await TrafficService.startRun("p1", "manual", START);

    expect(started.domainCount).toBe(2);
    expect(apify.startSimilarwebRun).toHaveBeenCalledWith([
      "own.test",
      "rival.test",
    ]);
  });

  it("updates a month it already holds instead of duplicating it", async () => {
    await TrafficService.startRun("p1", "manual", START);
    await TrafficService.collectRunningRuns(minutesLater(5));
    apify.getSimilarwebItems.mockResolvedValue([item("own.test", 1200)]);
    await TrafficService.startRun("p1", "manual", minutesLater(10));
    await TrafficService.collectRunningRuns(minutesLater(15));

    expect(
      await count(
        "SELECT count(*) FROM traffic_snapshots WHERE domain = 'own.test' AND month = '2026-10-01'",
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT visits FROM traffic_snapshots WHERE domain = 'own.test' AND month = '2026-10-01'",
      ),
    ).toBe(1200);
    expect(
      await count(
        "SELECT count(*) FROM traffic_channel_shares s JOIN traffic_snapshots t ON t.id = s.snapshot_id WHERE t.domain = 'own.test' AND t.month = '2026-10-01'",
      ),
    ).toBe(2);
  });

  it("leaves no running run behind when the provider rejects the start", async () => {
    apify.startSimilarwebRun.mockRejectedValue(new Error("APIFY_AUTH_FAILED"));

    await expect(
      TrafficService.startRun("p1", "manual", START),
    ).rejects.toThrow("APIFY_AUTH_FAILED");

    const overview = await TrafficService.getOverview("p1");
    expect(overview.activeRun).toBeNull();
    expect(await count("SELECT count(*) FROM traffic_runs")).toBe(0);
  });

  it("fails a run that is still running after 30 minutes", async () => {
    apify.getSimilarwebRun.mockResolvedValue({
      state: "running",
      datasetId: "ds_1",
      message: null,
    });
    await TrafficService.startRun("p1", "manual", START);

    await TrafficService.collectRunningRuns(minutesLater(29));
    expect((await TrafficService.getOverview("p1")).activeRun).not.toBeNull();

    await TrafficService.collectRunningRuns(minutesLater(31));
    const overview = await TrafficService.getOverview("p1");
    expect(overview.activeRun).toBeNull();
    expect(overview.lastError).toContain("timed out");
  });

  it("completes a run when the provider omits a domain", async () => {
    apify.getSimilarwebItems.mockResolvedValue([item("own.test", 1000)]);
    await TrafficService.startRun("p1", "manual", START);
    await TrafficService.collectRunningRuns(minutesLater(5));

    const overview = await TrafficService.getOverview("p1");
    expect(overview.lastCompletedAt).not.toBeNull();
    expect(overview.lastError).toBeNull();
    const rival = overview.brands.find((brand) => brand.name === "Rival");
    expect(rival?.domains[0].status).toBe("no_data");
    expect(rival?.latestVisits).toBeNull();
  });

  it("fails the run and keeps stored history when the data can't be read", async () => {
    await TrafficService.startRun("p1", "manual", START);
    await TrafficService.collectRunningRuns(minutesLater(5));
    apify.getSimilarwebItems.mockResolvedValue([{ visits: 5 }]);
    await TrafficService.startRun("p1", "manual", minutesLater(10));
    await TrafficService.collectRunningRuns(minutesLater(15));

    const overview = await TrafficService.getOverview("p1");
    expect(overview.activeRun).toBeNull();
    expect(overview.lastError).toContain("could not read");
    expect(overview.brands.find((brand) => brand.isOwn)?.latestVisits).toBe(
      1000,
    );
  });

  it("starts one scheduled run a month, from the 12th", async () => {
    await TrafficService.startScheduledRuns(new Date("2026-11-11T08:00:00Z"));
    expect(await count("SELECT count(*) FROM traffic_runs")).toBe(0);

    await TrafficService.startScheduledRuns(START);
    await TrafficService.collectRunningRuns(minutesLater(5));
    await TrafficService.startScheduledRuns(minutesLater(10));

    expect(
      await count(
        "SELECT count(*) FROM traffic_runs WHERE trigger = 'scheduled' AND status = 'completed'",
      ),
    ).toBe(1);
    expect(await count("SELECT count(*) FROM traffic_runs")).toBe(1);
  });

  it("stops retrying a scheduled start the provider keeps rejecting", async () => {
    apify.startSimilarwebRun.mockRejectedValue(new Error("APIFY_AUTH_FAILED"));
    const day = 24 * 60;

    await TrafficService.startScheduledRuns(START);
    await TrafficService.startScheduledRuns(minutesLater(60));
    expect(await count("SELECT count(*) FROM traffic_runs")).toBe(1);

    await TrafficService.startScheduledRuns(minutesLater(day + 5));
    await TrafficService.startScheduledRuns(minutesLater(2 * day + 10));
    await TrafficService.startScheduledRuns(minutesLater(3 * day + 15));

    expect(
      await count(
        "SELECT count(*) FROM traffic_runs WHERE trigger = 'scheduled' AND status = 'failed'",
      ),
    ).toBe(3);
    expect((await TrafficService.getOverview("p1")).lastError).not.toBeNull();
  });

  it("rejects a second start while a run is active", async () => {
    await TrafficService.startRun("p1", "manual", START);

    await expect(
      TrafficService.startRun("p1", "manual", minutesLater(1)),
    ).rejects.toMatchObject({ code: "TRAFFIC_RUN_ACTIVE" });
  });

  it("shows an untracked domain as not tracked, never as zero visits", async () => {
    apify.getSimilarwebItems.mockResolvedValue([
      item("own.test", 1000),
      {
        domain: "rival.test",
        status: "not_tracked",
        trafficDataAvailable: false,
      },
    ]);
    await TrafficService.startRun("p1", "manual", START);
    await TrafficService.collectRunningRuns(minutesLater(5));

    const overview = await TrafficService.getOverview("p1");
    const rival = overview.brands.find((brand) => brand.name === "Rival");
    expect(rival?.domains[0].status).toBe("not_tracked");
    expect(rival?.latestVisits).toBeNull();
    const own = overview.brands.find((brand) => brand.isOwn);
    expect(own?.name).toBe("Own Brand");
    expect(own?.latestVisits).toBe(1000);
  });
});
