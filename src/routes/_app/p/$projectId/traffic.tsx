import { createFileRoute } from "@tanstack/react-router";
import { TrafficPage } from "@/client/features/traffic/TrafficPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/traffic")({
  head: () => pageHead("Traffic"),
  component: TrafficRoute,
});

function TrafficRoute() {
  const { projectId } = Route.useParams();
  return <TrafficPage projectId={projectId} />;
}
