const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en-US");
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/** 1234567 → "1.2M". */
export function formatVisits(visits: number | null): string {
  return visits == null ? "—" : compact.format(visits);
}

export function formatRank(rank: number | null): string {
  return rank == null ? "—" : `#${whole.format(rank)}`;
}

/** A 0–1 share → "42%"; under one percent → "<1%". */
export function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/** "2026-10-01" → "Oct 2026". */
export function formatTrafficMonth(month: string): string {
  const date = new Date(`${month}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? month : monthLabel.format(date);
}

/** "organicSearch", "organic_search" or "Organic Search" → "Organic search". */
export function formatChannel(key: string): string {
  const words = key
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export function formatCountry(code: string): string {
  try {
    return countryNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

// Colorblind-safe categorical colors. The project's own brand is always first.
export const TRAFFIC_COLORS = [
  "#2563eb",
  "#e69f00",
  "#009e73",
  "#d55e00",
  "#cc79a7",
  "#56b4e9",
  "#7c3aed",
  "#64748b",
] as const;
