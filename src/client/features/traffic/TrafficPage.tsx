import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { getTrafficOverview, startTrafficRun } from "@/serverFunctions/traffic";
import type { TrafficOverview } from "@/shared/traffic";
import { TrafficBrandsTable } from "./TrafficBrandsTable";
import { TrafficChannelMix, TrafficCountries } from "./TrafficChannelMix";
import { TrafficVisitsChart } from "./TrafficVisitsChart";

// The chart stays readable with this many lines; the table lists every brand.
const MAX_CHART_BRANDS = 8;
const RUNNING_POLL_MS = 10_000;

export function TrafficPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["traffic-overview", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getTrafficOverview({ data: { projectId } }),
    // Results land on a scheduled tick, so poll only while a check is running.
    refetchInterval: (current) =>
      current.state.data?.activeRun ? RUNNING_POLL_MS : false,
  });
  const refresh = useMutation({
    mutationFn: () => startTrafficRun({ data: { projectId } }),
    onSuccess: (run) => {
      toast.success(
        `Checking ${run.domainCount} ${run.domainCount === 1 ? "domain" : "domains"}. Results arrive in a few minutes.`,
      );
    },
    onError: (error) => {
      toast.error(
        getStandardErrorMessage(error, "Couldn't start the traffic check."),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const overview = query.data;
  const isChecking = refresh.isPending || Boolean(overview?.activeRun);
  const canRefresh =
    Boolean(overview?.configured) && (overview?.brands.length ?? 0) > 0;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Traffic"
          description={
            <>
              Similarweb estimates via Apify. Monthly. Small sites may be
              untracked.
              {overview?.lastCompletedAt
                ? ` Last updated ${formatRelativeTime(overview.lastCompletedAt)}.`
                : ""}
            </>
          }
          actions={
            <Button
              variant="outline"
              disabled={!canRefresh || isChecking}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw className={isChecking ? "animate-spin" : undefined} />
              {isChecking ? "Checking…" : "Refresh"}
            </Button>
          }
        />
        <QueryState query={query} errorFallback="Couldn't load traffic data.">
          {(data) => (
            <TrafficContent
              projectId={projectId}
              overview={data}
              onRefresh={() => refresh.mutate()}
              isChecking={isChecking}
            />
          )}
        </QueryState>
      </div>
    </div>
  );
}

function TrafficContent({
  projectId,
  overview,
  onRefresh,
  isChecking,
}: {
  projectId: string;
  overview: TrafficOverview;
  onRefresh: () => void;
  isChecking: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { brands } = overview;
  const withData = brands.filter((brand) => brand.latestVisits != null);
  const selectedBrand =
    withData.find((brand) => brand.name === selected) ?? withData[0] ?? null;

  const notices = (
    <>
      {overview.configured ? null : (
        <Alert>
          <AlertTitle>Traffic data isn't set up</AlertTitle>
          <AlertDescription>
            Set <code>APIFY_API_TOKEN</code> in the server's environment and
            restart OpenSEO. The steps are in{" "}
            <code>docs/SELF_HOSTING_TRAFFIC.md</code>.
          </AlertDescription>
        </Alert>
      )}
      {overview.lastError ? (
        <Alert variant="destructive">
          <AlertTitle>The last traffic check failed</AlertTitle>
          <AlertDescription>{overview.lastError}</AlertDescription>
        </Alert>
      ) : null}
      {overview.activeRun ? (
        <Alert>
          <AlertTitle>Checking traffic</AlertTitle>
          <AlertDescription>
            Started {formatRelativeTime(overview.activeRun.startedAt)}. Results
            usually arrive within ten minutes; this page updates on its own.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );

  if (brands.length === 0) {
    return (
      <>
        {notices}
        <EmptyState
          title="No domains to track yet"
          description="Traffic is tracked for this project's own domain and its competitors. Give competitors that share a brand the same name to show a casino and its mirror domains as one line."
          action={
            <Button
              variant="outline"
              render={
                <Link to="/p/$projectId/context" params={{ projectId }} />
              }
            >
              Add competitors
            </Button>
          }
        />
      </>
    );
  }

  if (withData.length === 0 && !brands.some(hasAnyStatus)) {
    return (
      <>
        {notices}
        <EmptyState
          title="No traffic data yet"
          description={`${brands.length} ${brands.length === 1 ? "brand is" : "brands are"} ready to check. A check also runs on its own once a month.`}
          action={
            overview.configured ? (
              <Button disabled={isChecking} onClick={onRefresh}>
                {isChecking ? "Checking…" : "Check traffic now"}
              </Button>
            ) : undefined
          }
        />
      </>
    );
  }

  const chartBrands = withData.slice(0, MAX_CHART_BRANDS);
  return (
    <>
      {notices}
      {withData.length > 0 ? (
        <CardShell
          title="Visits over time"
          titleInfo={
            withData.length > chartBrands.length ? (
              <span className="text-xs font-normal text-muted-foreground">
                The {chartBrands.length} largest brands
              </span>
            ) : undefined
          }
        >
          <TrafficVisitsChart brands={chartBrands} />
        </CardShell>
      ) : null}
      <TrafficBrandsTable
        brands={brands}
        selectedBrand={selectedBrand?.name ?? null}
        onSelectBrand={setSelected}
      />
      {withData.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CardShell title="Channel mix">
            <TrafficChannelMix brands={withData} />
          </CardShell>
          {selectedBrand ? (
            <CardShell title={`Top countries: ${selectedBrand.name}`}>
              <TrafficCountries brand={selectedBrand} />
            </CardShell>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// True once any run has reported on the brand, even as "not tracked".
function hasAnyStatus(brand: TrafficOverview["brands"][number]): boolean {
  return brand.domains.some((domain) => domain.status !== "no_data");
}
