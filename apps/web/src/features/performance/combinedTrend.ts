import type { PerformancePercentile, PerformanceResponse } from "@/lib/api/performance";

/**
 * Core Web Vitals show by default; FCP and TTFB are opt-in so the chart stays readable.
 * Only CLS is dashed: it is the one series on the right-hand, unitless axis.
 */
export const vitalSeries = [
  { key: "lcp", name: "LCP", color: "var(--ds-chart-1)", dash: undefined, core: true },
  { key: "inp", name: "INP", color: "var(--ds-chart-2)", dash: undefined, core: true },
  { key: "cls", name: "CLS", color: "var(--ds-chart-3)", dash: "4 4", core: true },
  { key: "fcp", name: "FCP", color: "var(--ds-chart-4)", dash: undefined, core: false },
  { key: "ttfb", name: "TTFB", color: "var(--ds-chart-5)", dash: undefined, core: false },
] as const;

type TrendPoint = PerformanceResponse["trend"][number];
type VitalKey = (typeof vitalSeries)[number]["key"];

/**
 * Raw-unit values per bucket. With the server's interval, absent buckets are kept as gaps on
 * the shared grid (docs/agents/time-series.md) instead of silently joining distant points.
 */
export function combinedTrend(
  trend: PerformanceResponse["trend"],
  percentile: PerformancePercentile,
  range: { from?: string; to?: string; intervalSeconds?: number } = {},
) {
  const rows = trend.map((point) => {
    const value = (key: VitalKey) => {
      const value = point[key]?.[percentile];
      return value != null && Number.isFinite(value) && value >= 0 && (point[key]?.samples ?? 0) > 0
        ? value
        : null;
    };
    return {
      bucket: point.bucket,
      raw: point as Partial<TrendPoint>,
      lcp: value("lcp"),
      inp: value("inp"),
      cls: value("cls"),
      fcp: value("fcp"),
      ttfb: value("ttfb"),
    };
  });
  const { from, to, intervalSeconds } = range;
  if (!from || !to || !intervalSeconds || !rows.length) return rows;
  const step = intervalSeconds * 1000;
  const start = Math.floor(Date.parse(from) / step) * step;
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) / step > 1000) return rows;
  const byTime = new Map(rows.map((row) => [Date.parse(row.bucket), row]));
  const grid: typeof rows = [];
  for (let at = start; at < end; at += step) {
    grid.push(
      byTime.get(at) ?? {
        bucket: new Date(at).toISOString(),
        raw: {},
        lcp: null,
        inp: null,
        cls: null,
        fcp: null,
        ttfb: null,
      },
    );
  }
  return grid;
}
