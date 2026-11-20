import { sortBy } from "remeda";
import type { TrafficBrand } from "@/shared/traffic";
import {
  TRAFFIC_COLORS,
  formatChannel,
  formatCountry,
  formatShare,
} from "./trafficFormat";

/** One stacked bar per brand: where its visits come from. */
export function TrafficChannelMix({ brands }: { brands: TrafficBrand[] }) {
  const withChannels = brands.filter((brand) => brand.channels.length > 0);
  // One color per channel across every bar, biggest channels first.
  const totals = new Map<string, number>();
  for (const brand of withChannels) {
    for (const { key, share } of brand.channels) {
      totals.set(key, (totals.get(key) ?? 0) + share);
    }
  }
  const channelKeys = sortBy([...totals], [([, total]) => total, "desc"]).map(
    ([key]) => key,
  );
  const colorOf = (key: string) =>
    TRAFFIC_COLORS[channelKeys.indexOf(key) % TRAFFIC_COLORS.length];

  if (withChannels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No channel breakdown yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {channelKeys.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: colorOf(key) }}
            />
            {formatChannel(key)}
          </li>
        ))}
      </ul>
      <ul className="space-y-2">
        {withChannels.map((brand) => (
          <li key={brand.name} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{brand.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatChannel(brand.channels[0].key)}{" "}
                {formatShare(brand.channels[0].share)}
              </span>
            </div>
            <div
              className="flex h-3 w-full overflow-hidden rounded-sm bg-muted"
              role="img"
              aria-label={`${brand.name}: ${brand.channels
                .map(
                  ({ key, share }) =>
                    `${formatChannel(key)} ${formatShare(share)}`,
                )
                .join(", ")}`}
            >
              {brand.channels.map(({ key, share }) => (
                <span
                  key={key}
                  title={`${formatChannel(key)} ${formatShare(share)}`}
                  style={{
                    width: `${share * 100}%`,
                    backgroundColor: colorOf(key),
                  }}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The top countries of one brand's visits. */
export function TrafficCountries({ brand }: { brand: TrafficBrand }) {
  if (brand.countries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No country breakdown for {brand.name} yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {brand.countries.map(({ key, share }) => (
        <li key={key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{formatCountry(key)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatShare(share)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${share * 100}%`,
                backgroundColor: TRAFFIC_COLORS[0],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
