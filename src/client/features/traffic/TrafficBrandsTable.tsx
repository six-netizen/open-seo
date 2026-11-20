import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { TrafficBrand, TrafficDomainSeries } from "@/shared/traffic";
import {
  formatChannel,
  formatCountry,
  formatRank,
  formatShare,
  formatTrafficMonth,
  formatVisits,
} from "./trafficFormat";

const STATUS_LABEL = {
  not_tracked: "Not tracked",
  no_data: "No data",
} as const;

function MomChange({ percent }: { percent: number | null }) {
  if (percent == null) return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(percent * 10) / 10;
  return (
    <span
      className={cn(
        "tabular-nums",
        rounded > 0 && "text-emerald-600 dark:text-emerald-400",
        rounded < 0 && "text-red-600 dark:text-red-400",
      )}
    >
      {rounded > 0 ? "+" : ""}
      {rounded}%
    </span>
  );
}

// A brand with no figures says why, in the visits column.
function brandStatus(brand: TrafficBrand): string | null {
  if (brand.latestVisits != null) return null;
  return brand.domains.some((domain) => domain.status === "not_tracked")
    ? STATUS_LABEL.not_tracked
    : STATUS_LABEL.no_data;
}

function DomainRow({ domain }: { domain: TrafficDomainSeries }) {
  const latestVisits =
    domain.latest &&
    domain.visitsByMonth.find((entry) => entry.month === domain.latest?.month)
      ?.visits;
  return (
    <TableRow className="bg-muted/30">
      <TableCell className="text-muted-foreground">
        {/* Lines up under the brand name, past the expand button. */}
        <span className="pl-6">{domain.domain}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {domain.status === "ok"
          ? formatVisits(latestVisits ?? null)
          : STATUS_LABEL[domain.status]}
      </TableCell>
      <TableCell />
      <TableCell>
        {domain.latest?.channels[0]
          ? formatChannel(domain.latest.channels[0].key)
          : "—"}
      </TableCell>
      <TableCell>
        {domain.latest?.countries[0]
          ? formatCountry(domain.latest.countries[0].key)
          : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRank(domain.latest?.globalRank ?? null)}
      </TableCell>
    </TableRow>
  );
}

/** One row per brand; a brand with several domains expands to show each. */
export function TrafficBrandsTable({
  brands,
  selectedBrand,
  onSelectBrand,
}: {
  brands: TrafficBrand[];
  selectedBrand: string | null;
  onSelectBrand: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const latestMonth = brands
    .flatMap((brand) => (brand.latestMonth ? [brand.latestMonth] : []))
    .reduce<
      string | null
    >((newest, month) => (newest == null || month > newest ? month : newest), null);
  const toggle = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead className="text-right">
              Visits{latestMonth ? ` (${formatTrafficMonth(latestMonth)})` : ""}
            </TableHead>
            <TableHead className="text-right">Month over month</TableHead>
            <TableHead>Top channel</TableHead>
            <TableHead>Top country</TableHead>
            <TableHead className="text-right">Global rank</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand) => {
            const multi = brand.domains.length > 1;
            const open = expanded.has(brand.name);
            const status = brandStatus(brand);
            const Chevron = open ? ChevronDown : ChevronRight;
            // An older month than the header's is labelled on the row.
            const staleMonth =
              brand.latestMonth && brand.latestMonth !== latestMonth
                ? formatTrafficMonth(brand.latestMonth)
                : null;
            return (
              <Fragment key={`${brand.isOwn}:${brand.name}`}>
                <TableRow
                  data-state={
                    selectedBrand === brand.name ? "selected" : undefined
                  }
                  className="cursor-pointer"
                  onClick={() => onSelectBrand(brand.name)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {multi ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? "Hide" : "Show"} ${brand.name} domains`}
                          className="rounded-sm text-muted-foreground hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(brand.name);
                          }}
                        >
                          <Chevron className="size-4" />
                        </button>
                      ) : (
                        <span className="size-4" />
                      )}
                      <span className="font-medium">{brand.name}</span>
                      {brand.isOwn ? (
                        <Badge variant="secondary">You</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {multi
                          ? `${brand.domains.length} domains`
                          : brand.domains[0]?.domain !== brand.name
                            ? brand.domains[0]?.domain
                            : null}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {status ?? formatVisits(brand.latestVisits)}
                    {staleMonth ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {staleMonth}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <MomChange percent={brand.momChangePercent} />
                  </TableCell>
                  <TableCell>
                    {brand.channels[0]
                      ? `${formatChannel(brand.channels[0].key)} ${formatShare(brand.channels[0].share)}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {brand.countries[0]
                      ? `${formatCountry(brand.countries[0].key)} ${formatShare(brand.countries[0].share)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRank(brand.globalRank)}
                  </TableCell>
                </TableRow>
                {multi && open
                  ? brand.domains.map((domain) => (
                      <DomainRow key={domain.domain} domain={domain} />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}
