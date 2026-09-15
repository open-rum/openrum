import type { PerformancePercentile, PerformanceResponse } from "@/lib/api/performance";

export const vitalSeries = [
  { key: "lcp", name: "LCP", color: "var(--ds-chart-1)", dash: undefined },
  { key: "inp", name: "INP", color: "var(--ds-chart-2)", dash: "7 4" },
  { key: "cls", name: "CLS", color: "var(--ds-chart-3)", dash: "2 4" },
  { key: "fcp", name: "FCP", color: "var(--ds-chart-4)", dash: "10 3 2 3" },
  { key: "ttfb", name: "TTFB", color: "var(--ds-chart-5)", dash: "4 3" },
] as const;

export function combinedTrend(
  trend: PerformanceResponse["trend"],
  percentile: PerformancePercentile,
) {
  return trend.map((point) => {
    const value = (key: (typeof vitalSeries)[number]["key"]) => {
      const value = point[key]?.[percentile];
      return value != null && Number.isFinite(value) && value >= 0 && (point[key]?.samples ?? 0) > 0
        ? value
        : null;
    };
    return {
      bucket: point.bucket,
      raw: point,
      lcp: value("lcp"),
      inp: value("inp"),
      cls: value("cls"),
      fcp: value("fcp"),
      ttfb: value("ttfb"),
    };
  });
}
