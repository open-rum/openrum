// The shape every Console chart is drawn from, and the figures' formatting. The dashboard
// and the other pages each turn their own API responses into PlotData, so a chart looks the
// same wherever it appears. Components that draw it live in components/charts.

/** A partial series is keyed after the series it continues. */
export const PARTIAL_SUFFIX = "__partial";

export type Unit = "count" | "percent" | "ms" | "score" | "number";
export type SeriesDefinition = {
  key: string;
  label: string;
  unit: Unit;
  color: string;
  ink: string;
  /**
   * "previous" is the comparison period, drawn dashed behind the current one. "partial" is
   * the stretch of a series covering a bucket that has not run its whole interval, drawn
   * dashed in the series' own colour and left out of the legend.
   */
  role?: "current" | "previous" | "other" | "partial";
  /** Which value axis the series reads. "right" adds a second axis, for a different unit. */
  axis?: "left" | "right";
};
export type PlotData = {
  kind: "series" | "categories";
  rows: Array<Record<string, string | number | null>>;
  series: SeriesDefinition[];
  note: string;
  empty: boolean;
  thresholds?: { good: number; poor: number };
  intervalSeconds?: number;
  rangeMs?: number;
  stacked?: boolean;
  comparison?: { from: string; to: string };
  /** A line under the chart explaining something about its edges, such as a partial bucket. */
  edgeNote?: string;
  distribution?: {
    dimension: string;
    limitReached: boolean;
    rowLimit: number;
    nonAdditive: boolean;
    /** False for rates, percentiles and distinct counts: their groups are not parts of a whole. */
    shareable?: boolean;
  };
};
const counts = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });
export function formatMetric(value: number | null, unit: Unit): string {
  if (value === null) return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "score") return value.toFixed(3);
  if (unit === "ms")
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  return counts.format(value);
}

const numbers = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

/** Detail tables retain full counts and milliseconds, without compact-unit rounding. */
export function formatDetailedMetric(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "number") return numbers.format(value);
  if (unit === "count" || unit === "ms") {
    const number = value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    return unit === "ms" ? `${number} ms` : number;
  }
  return formatMetric(value, unit);
}
