import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getOverview, type OverviewResponse } from "@/lib/api/client";
import {
  getBehaviorAnalytics,
  type BehaviorAnalyticsResponse,
  type BehaviorFilters,
  type BehaviorDimension,
} from "@/lib/api/analytics";
import {
  getMetricCatalog,
  metricsQueryString,
  queryMetrics,
  type MetricsQueryParams,
  type MetricsResult,
} from "@/lib/api/metricsQuery";
import type { OverviewFilters } from "@/lib/filters/schema";
import { readWidget, rememberCatalogLabels, type StoredWidget, type Widget } from "./model";
import { DASHBOARD_MAX_POINTS, useDashboardPointBudget } from "./chartDensity";

export type DashboardData =
  | { source: "overview"; result: OverviewResponse }
  | { source: "events"; result: BehaviorAnalyticsResponse }
  | { source: "catalog"; result: MetricsResult };
export type ModuleQuery = UseQueryResult<DashboardData, Error>;

// One shared queue also covers the editor preview. Requests waiting for a slot
// are removed immediately on cancellation rather than delaying new filters.
let active = 0;
const queue: Array<() => void> = [];
async function limited<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", abort);
      active++;
      resolve();
    };
    const abort = () => {
      const i = queue.indexOf(start);
      if (i >= 0) queue.splice(i, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    if (active < 6) start();
    else {
      queue.push(start);
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  try {
    signal.throwIfAborted();
    return await run();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export function effectiveOverviewFilters(
  widget: Widget,
  filters: OverviewFilters,
): OverviewFilters {
  return {
    ...filters,
    release:
      filters.release || (widget.data.source === "overview" ? widget.data.release : undefined),
    route: filters.route || (widget.data.source === "overview" ? widget.data.route : undefined),
  };
}

// Metric id prefixes name their source. Measurement rows carry one dimension each, so a
// page-level release or route link cannot narrow them and must not be forwarded there.
const linkFilterSources = new Set(["traffic", "vitals", "api", "issues"]);

/**
 * The query a catalog module sends. A stat always carries its comparison and a ranked
 * table always carries its change and sparkline, so switching a stat's appearance never
 * issues a new query and a stat shares its request with a matching trend.
 */
export function catalogQueryParams(
  widget: Widget,
  filters: OverviewFilters,
  maxPoints: number,
): MetricsQueryParams {
  if (widget.data.source !== "catalog") throw new Error("not a catalog module");
  const data = widget.data;
  const stacked = widget.view === "stacked-area" || widget.view === "stacked-bar";
  let shape: MetricsQueryParams["shape"] = "series";
  let stack: MetricsQueryParams["stack"];
  let compare = data.compare === "previous";
  let sparkline = data.sparkline ?? false;
  if (widget.type === "stat") compare = true;
  else if (widget.type === "timeseries") {
    shape = data.dimension ? "seriesByDimension" : "series";
    if (stacked) stack = data.dimension ? "dimension" : "metrics";
  } else if (widget.type === "breakdown") shape = "breakdown";
  else if (widget.type === "ranked-table") {
    shape = "table";
    compare = true;
    sparkline = true;
  } else if (widget.type === "metric-table") shape = "table";

  const moduleFilters = { ...data.filters };
  const source = data.metrics[0]?.split(".")[0] ?? "";
  if (linkFilterSources.has(source)) {
    for (const key of ["release", "route"] as const) {
      if (filters[key] && data.dimension !== key) moduleFilters[key] = filters[key];
    }
  }
  return {
    projectId: filters.projectId,
    from: filters.from,
    to: filters.to,
    environment: filters.environment,
    maxPoints,
    metrics: data.metrics,
    shape,
    dimension: shape === "series" ? undefined : data.dimension,
    measurement: data.measurement,
    filters: moduleFilters,
    compare: shape === "seriesByDimension" ? false : compare,
    // Pinned groups replace the limit.
    topN: data.groups?.length ? undefined : data.topN,
    sort: data.sort,
    order: data.order,
    sparkline: shape === "table" ? sparkline : false,
    stack,
    groups: shape === "series" ? undefined : data.groups,
  };
}

export function moduleQueryOptions(
  widget: Widget,
  filters: OverviewFilters,
  userId: string,
  maxPoints = DASHBOARD_MAX_POINTS,
) {
  const { from, to, environment, projectId } = filters;
  const base = [
    "dashboard-data",
    userId,
    projectId,
    from.toISOString(),
    to.toISOString(),
    environment ?? "",
    maxPoints,
  ] as const;
  if (widget.data.source === "catalog") {
    const params = catalogQueryParams(widget, filters, maxPoints);
    return {
      queryKey: [...base, "catalog", metricsQueryString(params)],
      queryFn: ({ signal }: { signal: AbortSignal }): Promise<DashboardData> =>
        limited(signal, async () => ({
          source: "catalog",
          result: await queryMetrics(params, signal),
        })),
      staleTime: 30_000,
      enabled: maxPoints > 0,
    };
  }
  if (widget.data.source === "overview") {
    const effective = effectiveOverviewFilters(widget, filters);
    return {
      queryKey: [...base, "overview", effective.release ?? "", effective.route ?? ""],
      queryFn: ({ signal }: { signal: AbortSignal }): Promise<DashboardData> =>
        limited(signal, async () => ({
          source: "overview",
          result: await getOverview(effective, signal, maxPoints),
        })),
      staleTime: 30_000,
      enabled: maxPoints > 0,
    };
  }
  const data = widget.data;
  const eventFilters: BehaviorFilters = {
    projectId,
    from,
    to,
    environment,
    maxPoints,
    eventKind: data.eventKind,
    eventName: data.eventName,
    dimension: data.dimension as BehaviorDimension,
  };
  return {
    queryKey: [...base, "events", data.eventKind ?? "", data.eventName ?? "", data.dimension],
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<DashboardData> =>
      limited(signal, async () => ({
        source: "events",
        result: await getBehaviorAnalytics(eventFilters, signal),
      })),
    staleTime: 30_000,
    enabled: maxPoints > 0,
  };
}

export function useDashboardQueries(
  widgets: StoredWidget[],
  filters: OverviewFilters,
  userId: string,
) {
  const maxPoints = useDashboardPointBudget();
  const options = new Map<string, ReturnType<typeof moduleQueryOptions>>();
  const identities = new Map<string, string>();
  for (const record of widgets) {
    const widget = readWidget(record);
    if (!widget) continue;
    const query = moduleQueryOptions(widget, filters, userId, maxPoints);
    const key = JSON.stringify(query.queryKey);
    options.set(key, query);
    identities.set(widget.id, key);
  }
  const entries = [...options.entries()];
  const results = useQueries({ queries: entries.map(([, query]) => query) });
  const byKey = new Map(entries.map(([key], index) => [key, results[index]]));
  return new Map([...identities].map(([id, key]) => [id, byKey.get(key)!]));
}

/**
 * The metric catalog. Only the editor and presets need it: rendering reads each
 * response's own metric metadata, so a slow catalog never delays the dashboard.
 */
export function useMetricCatalog(projectId: string, userId: string, enabled = true) {
  return useQuery({
    queryKey: ["dashboard-catalog", userId, projectId],
    queryFn: async ({ signal }) => {
      const catalog = await getMetricCatalog(projectId, signal);
      rememberCatalogLabels(catalog.metrics);
      return catalog;
    },
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useModulePreview(widget: Widget, filters: OverviewFilters, userId: string) {
  const maxPoints = useDashboardPointBudget();
  return useQuery(moduleQueryOptions(widget, filters, userId, maxPoints));
}
