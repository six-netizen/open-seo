import { Line, LineChart } from "recharts";
import { sortBy, unique } from "remeda";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import type { TrafficBrand } from "@/shared/traffic";
import {
  TRAFFIC_COLORS,
  formatTrafficMonth,
  formatVisits,
} from "./trafficFormat";

const formatAxis = (value: unknown) =>
  typeof value === "number" ? formatVisits(value) : "";
const formatLabel = (value: unknown) =>
  typeof value === "string" ? formatTrafficMonth(value) : "";

/** Monthly visits, one line per brand. A month a brand has no figure for is a gap. */
export function TrafficVisitsChart({ brands }: { brands: TrafficBrand[] }) {
  const series = brands.map((brand, index) => ({
    key: `brand${index}`,
    brand,
    color: TRAFFIC_COLORS[index % TRAFFIC_COLORS.length],
  }));
  const config: ChartConfig = Object.fromEntries(
    series.map(({ key, brand, color }) => [key, { label: brand.name, color }]),
  );
  const months = sortBy(
    unique(brands.flatMap((brand) => brand.visitsByMonth.map((m) => m.month))),
    (month) => month,
  );
  const data = months.map((month) => ({
    month,
    ...Object.fromEntries(
      series.map(({ key, brand }) => [
        key,
        brand.visitsByMonth.find((entry) => entry.month === month)?.visits ??
          null,
      ]),
    ),
  }));

  return (
    <ChartContainer
      config={config}
      className="h-64"
      aria-label="Monthly visits by brand"
    >
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <ChartGrid />
        <ChartXAxis dataKey="month" tickFormatter={formatLabel} />
        <ChartYAxis tickFormatter={formatAxis} width={52} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={formatLabel}
              valueFormatter={formatAxis}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map(({ key }) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            // Dots stay on: with one stored month a line has nothing to draw.
            dot={{ r: 2 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
