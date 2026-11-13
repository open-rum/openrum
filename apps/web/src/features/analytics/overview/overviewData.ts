import type { MetricsQueryParams, MetricsResult, MetricValue } from "@/lib/api/metricsQuery";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";

// The behaviour overview reads the shared metric catalog only, with the same e-commerce
// event convention as the dashboard template (features/dashboard/ecommerce.ts): Custom
// Events view_item, add_to_cart, begin_checkout and purchase, revenue from purchase's
// `amount` measurement. Every figure is a value or a comparison; the page draws no verdicts.
// Revenue and orders are both restored by the sample rate, so they stay right when the
// Project samples events and their ratio (average order value) is not inflated.

export const REVENUE_MEASUREMENT = "amount";
export const REVENUE_METRIC = "measurement.estimated";
export const ORDERS_METRIC = "behavior.events";
export const purchaseEvent = { eventKind: "custom", eventName: "purchase" } as const;
export const funnelEvents = ["view_item", "add_to_cart", "begin_checkout", "purchase"] as const;
/** Conversion by region or source is only ranked once it rests on this many sessions. */
export const MIN_CONVERSION_SESSIONS = 50;
/** Active users count everyone who sent any behaviour event in this window. */
export const ACTIVE_WINDOW_MINUTES = 30;
export const ACTIVE_REFRESH_MS = 10_000;

export type OverviewScope = { projectId: string; from: Date; to: Date; environment?: string };
export type MapMetric = "active" | "sessions" | "revenue" | "conversion";

const base = (scope: OverviewScope) => ({
  projectId: scope.projectId,
  from: scope.from,
  to: scope.to,
  environment: scope.environment,
  maxPoints: TIME_SERIES_MAX_POINTS,
});

// The catalog draws one unit per query: revenue (a number) and orders (a count) are asked
// for separately, each with its previous period.
export function revenueSeriesQuery(scope: OverviewScope): MetricsQueryParams {
  return {
    ...base(scope),
    shape: "series",
    metrics: [REVENUE_METRIC],
    measurement: REVENUE_MEASUREMENT,
    filters: { eventName: purchaseEvent.eventName },
    compare: true,
  };
}

/** Orders are purchase events. */
export function ordersSeriesQuery(scope: OverviewScope): MetricsQueryParams {
  return {
    ...base(scope),
    shape: "series",
    metrics: [ORDERS_METRIC],
    filters: { ...purchaseEvent },
    compare: true,
  };
}

export function trafficSeriesQuery(scope: OverviewScope): MetricsQueryParams {
  return {
    ...base(scope),
    shape: "series",
    metrics: ["traffic.sessions", "traffic.uniqueUsers"],
    compare: true,
  };
}

export function purchaseSessionsSeriesQuery(scope: OverviewScope): MetricsQueryParams {
  return {
    ...base(scope),
    shape: "series",
    metrics: ["behavior.sessions"],
    filters: { ...purchaseEvent },
    compare: true,
  };
}

export function breakdownQuery(
  scope: OverviewScope,
  dimension: "country" | "source",
  kind: "sessions" | "revenue" | "purchaseSessions",
): MetricsQueryParams {
  const shared = { ...base(scope), shape: "breakdown" as const, dimension, topN: 50 };
  if (kind === "revenue")
    return {
      ...shared,
      metrics: [REVENUE_METRIC],
      measurement: REVENUE_MEASUREMENT,
      filters: { eventName: purchaseEvent.eventName },
    };
  if (kind === "purchaseSessions")
    return { ...shared, metrics: ["behavior.sessions"], filters: { ...purchaseEvent } };
  // traffic.sessions has no source split; page-view sessions of the behaviour rollup do.
  return dimension === "country"
    ? { ...shared, metrics: ["traffic.sessions"] }
    : { ...shared, metrics: ["behavior.sessions"], filters: { eventKind: "page_view" } };
}

/** The active window ends after the current minute, so its last bucket is still filling. */
export function activeWindow(now: Date) {
  const to = new Date(now);
  to.setUTCSeconds(0, 0);
  to.setUTCMinutes(to.getUTCMinutes() + 1);
  return { from: new Date(to.getTime() - ACTIVE_WINDOW_MINUTES * 60_000), to };
}

export function activeSeriesQuery(scope: OverviewScope, now: Date): MetricsQueryParams {
  return {
    ...base(scope),
    ...activeWindow(now),
    maxPoints: ACTIVE_WINDOW_MINUTES,
    shape: "series",
    metrics: ["behavior.users"],
  };
}

export function activeByCountryQuery(scope: OverviewScope, now: Date): MetricsQueryParams {
  return {
    ...base(scope),
    ...activeWindow(now),
    shape: "breakdown",
    dimension: "country",
    metrics: ["behavior.users"],
    topN: 50,
  };
}

export function valueOf(value: MetricValue | undefined | null) {
  return typeof value?.value === "number" && Number.isFinite(value.value) ? value.value : null;
}

export function ratio(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator ? numerator / denominator : null;
}

/** Rows of a breakdown keyed by their dimension value. */
export function rowsByValue(result: MetricsResult | undefined, metric: string) {
  const map = new Map<string, number>();
  for (const row of result?.rows ?? []) {
    const value = valueOf(row.values[metric]);
    if (value !== null) map.set(row.value, value);
  }
  return map;
}

export type RegionFigures = {
  code: string;
  active: number | null;
  sessions: number | null;
  revenue: number | null;
  conversion: number | null;
};

/** Joins the per-country breakdowns into one record per country. */
export function regionFigures(input: {
  active?: MetricsResult;
  sessions?: MetricsResult;
  revenue?: MetricsResult;
  purchaseSessions?: MetricsResult;
}): RegionFigures[] {
  const active = rowsByValue(input.active, "behavior.users");
  const sessions = rowsByValue(input.sessions, "traffic.sessions");
  const revenue = rowsByValue(input.revenue, REVENUE_METRIC);
  const purchases = rowsByValue(input.purchaseSessions, "behavior.sessions");
  const codes = new Set([...active.keys(), ...sessions.keys(), ...revenue.keys()]);
  return [...codes]
    .filter((code) => /^[A-Z]{2}$/.test(code) && code !== "ZZ")
    .map((code) => {
      const visits = sessions.get(code) ?? null;
      return {
        code,
        active: active.get(code) ?? null,
        sessions: visits,
        revenue: revenue.get(code) ?? null,
        conversion:
          visits !== null && visits >= MIN_CONVERSION_SESSIONS
            ? ratio(purchases.get(code) ?? 0, visits)
            : null,
      };
    });
}

export function metricValue(region: RegionFigures, metric: MapMetric) {
  return region[metric];
}

/** Regions with a value for the metric, largest first. */
export function rankRegions(regions: RegionFigures[], metric: MapMetric) {
  return regions
    .filter((region) => (metricValue(region, metric) ?? 0) > 0)
    .sort((a, b) => (metricValue(b, metric) ?? 0) - (metricValue(a, metric) ?? 0));
}

/** Fill opacity per intensity level; level 0 is a country without data (drawn in base-300). */
export const levelOpacity = [0.16, 0.36, 0.52, 0.68, 0.84, 1];

/** Five intensity steps on a square-root scale, so one large market does not flatten the rest. */
export function intensityLevel(value: number, max: number) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(5, Math.max(1, Math.ceil(Math.sqrt(value / max) * 5)));
}

export type Change = { kind: "percent" | "points"; value: number } | null;

export function percentChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null || previous === 0) return null;
  return { kind: "percent", value: ((current - previous) / previous) * 100 };
}

export function pointsChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return null;
  return { kind: "points", value: (current - previous) * 100 };
}

/** Bucket-wise ratio of two aligned series; a missing or zero denominator stays a gap. */
export function seriesRatio(
  numerator: ReadonlyArray<MetricValue | null> | undefined,
  denominator: ReadonlyArray<MetricValue | null> | undefined,
) {
  return (denominator ?? []).map((point, index) =>
    ratio(valueOf(numerator?.[index]), valueOf(point)),
  );
}

export function seriesValues(result: MetricsResult | undefined, metric: string) {
  return (result?.series?.find((series) => series.metric === metric)?.points ?? []).map(valueOf);
}

export function seriesPoints(result: MetricsResult | undefined, metric: string) {
  return result?.series?.find((series) => series.metric === metric)?.points ?? [];
}

export type SourceRow = {
  value: string;
  sessions: number | null;
  revenue: number | null;
  conversion: number | null;
  revenuePerSession: number | null;
  share: number | null;
};

/** Sources by revenue, then sessions; at most `limit` rows. */
export function sourceRows(
  input: { sessions?: MetricsResult; revenue?: MetricsResult; purchaseSessions?: MetricsResult },
  totalRevenue: number | null,
  limit = 8,
): SourceRow[] {
  const sessions = rowsByValue(input.sessions, "behavior.sessions");
  const revenue = rowsByValue(input.revenue, REVENUE_METRIC);
  const purchases = rowsByValue(input.purchaseSessions, "behavior.sessions");
  return [...new Set([...revenue.keys(), ...sessions.keys()])]
    .map((value) => {
      const visits = sessions.get(value) ?? null;
      const income = revenue.get(value) ?? null;
      return {
        value,
        sessions: visits,
        revenue: income,
        conversion:
          visits !== null && visits >= MIN_CONVERSION_SESSIONS
            ? ratio(purchases.get(value) ?? 0, visits)
            : null,
        revenuePerSession: ratio(income ?? 0, visits),
        share: ratio(income, totalRevenue),
      };
    })
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || (b.sessions ?? 0) - (a.sessions ?? 0))
    .slice(0, limit);
}
