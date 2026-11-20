import { TrafficService } from "@/server/features/traffic/services/TrafficService";
import { isApifyConfigured } from "@/server/lib/apify/similarweb";

// Cron body for the `scheduled` Worker handler, every five minutes: store the
// results of traffic runs the provider has finished, then start the monthly
// run of each project that is due. Does nothing until APIFY_API_TOKEN is set.
export async function runScheduledTrafficChecks(
  now: Date = new Date(),
): Promise<void> {
  if (!(await isApifyConfigured())) return;
  await TrafficService.collectRunningRuns(now);
  await TrafficService.startScheduledRuns(now);
}
