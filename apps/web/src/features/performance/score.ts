import {
  performanceMetricNames,
  type PerformanceMetricKey,
  type PerformanceMetricName,
  type PerformanceResponse,
} from "@/lib/api/performance";

export type PerformanceRating = "good" | "needs-improvement" | "poor" | "unknown";

// Sentry's default weights; OpenRUM retains its own overall-P75 scoring curve.
// https://docs.sentry.io/product/dashboards/sentry-dashboards/frontend/web-vitals/#performance-score
export const performanceScoreWeights = {
  LCP: 30,
  INP: 30,
  CLS: 15,
  FCP: 15,
  TTFB: 10,
} as const satisfies Record<PerformanceMetricName, number>;

export const performanceThresholds: Record<PerformanceMetricName, { good: number; poor: number }> =
  {
    LCP: { good: 2500, poor: 4000 },
    INP: { good: 200, poor: 500 },
    CLS: { good: 0.1, poor: 0.25 },
    FCP: { good: 1800, poor: 3000 },
    TTFB: { good: 800, poor: 1800 },
  };

export function performanceRating(
  value: number | null,
  metric: PerformanceMetricName,
): PerformanceRating {
  if (value === null) return "unknown";
  const threshold = performanceThresholds[metric];
  if (value <= threshold.good) return "good";
  if (value <= threshold.poor) return "needs-improvement";
  return "poor";
}

export function performanceScore(value: number | null, metric: PerformanceMetricName) {
  if (value === null) return null;
  const { good, poor } = performanceThresholds[metric];
  let score: number;
  if (value <= good) {
    score = 100 - (value / good) * 10;
  } else if (value <= poor) {
    score = 90 - ((value - good) / (poor - good)) * 40;
  } else {
    score = 50 - ((value - poor) / poor) * 50;
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

type RoutePerformance = PerformanceResponse["routes"][number];

/** Preserve the existing scoring curve, using the actual filtered overall P75s. */
export function overallPerformanceScore(summary: PerformanceResponse["summary"]) {
  const metrics = performanceMetricNames.map((name) => {
    const metric = summary?.[name.toLowerCase() as PerformanceMetricKey];
    const valid =
      metric &&
      metric.samples > 0 &&
      metric.p75 !== null &&
      Number.isFinite(metric.p75) &&
      metric.p75 >= 0;
    return {
      name,
      weight: performanceScoreWeights[name],
      score: valid ? performanceScore(metric.p75, name) : null,
      sufficient: Boolean(valid && metric.sufficient),
    };
  });
  const available = metrics.filter((metric) => metric.score !== null);
  const availableWeight = available.reduce((total, metric) => total + metric.weight, 0);
  return {
    score: availableWeight
      ? Math.round(
          available.reduce((total, metric) => total + metric.score! * metric.weight, 0) /
            availableWeight,
        )
      : null,
    complete: available.length === metrics.length && metrics.every((metric) => metric.sufficient),
    available: available.length,
    metrics,
  };
}

export function summarizePerformance(routes: RoutePerformance[]) {
  const metrics = (["LCP", "INP", "CLS"] as PerformanceMetricName[]).map((name) => {
    const key = name.toLowerCase() as "lcp" | "inp" | "cls";
    const measured = routes.filter((route) => route[key].p75 !== null && route[key].samples > 0);
    const preferred = measured.filter((route) => route[key].sufficient);
    const candidates = preferred.length ? preferred : measured;
    const totalWeight = candidates.reduce((total, route) => total + route[key].samples, 0);
    const weightedScore = totalWeight
      ? candidates.reduce(
          (total, route) =>
            total + (performanceScore(route[key].p75, name) ?? 0) * route[key].samples,
          0,
        ) / totalWeight
      : null;
    const primary = [...candidates].sort(
      (left, right) => right[key].samples - left[key].samples,
    )[0];
    const goodRoutes = measured.filter(
      (route) => performanceRating(route[key].p75, name) === "good",
    ).length;
    return {
      name,
      score: weightedScore === null ? null : Math.round(weightedScore),
      p75: primary?.[key].p75 ?? null,
      samples: candidates.reduce((total, route) => total + route[key].samples, 0),
      goodRoutes,
      measuredRoutes: measured.length,
    };
  });
  const available = metrics.filter((metric) => metric.score !== null);
  const score = available.length
    ? Math.round(
        available.reduce((total, metric) => total + (metric.score ?? 0), 0) / available.length,
      )
    : null;
  return {
    score,
    metrics,
    pageViews: routes.reduce((total, route) => total + route.pageViews, 0),
    measuredRoutes: new Set(
      routes
        .filter((route) => route.lcp.samples || route.inp.samples || route.cls.samples)
        .map((route) => route.route),
    ).size,
  };
}

export function scoreRating(score: number | null): PerformanceRating {
  if (score === null) return "unknown";
  if (score >= 90) return "good";
  if (score >= 50) return "needs-improvement";
  return "poor";
}

export function ratingLabel(rating: PerformanceRating) {
  switch (rating) {
    case "good":
      return "良好";
    case "needs-improvement":
      return "待优化";
    case "poor":
      return "较差";
    default:
      return "暂无数据";
  }
}
