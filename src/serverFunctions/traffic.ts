import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TrafficService } from "@/server/features/traffic/services/TrafficService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { TRAFFIC_MAX_MONTHS } from "@/shared/traffic";

const overviewInputSchema = z.object({
  projectId: z.string().min(1),
  months: z.number().int().min(1).max(TRAFFIC_MAX_MONTHS).optional(),
});

const startRunInputSchema = z.object({ projectId: z.string().min(1) });

/** Stored competitor traffic for the project. Reads only; costs nothing. */
export const getTrafficOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(overviewInputSchema)
  .handler(({ data, context }) =>
    TrafficService.getOverview(context.projectId, data.months),
  );

/** Start a traffic check. Results arrive on a later scheduled tick. */
export const startTrafficRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startRunInputSchema)
  .handler(({ context }) =>
    TrafficService.startRun(context.projectId, "manual"),
  );
