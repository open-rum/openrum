import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getOverview, type OverviewResponse } from "@/lib/api/client";
import {
  getBehaviorAnalytics,
  type BehaviorAnalyticsResponse,
  type BehaviorFilters,
  type BehaviorDimension,
} from "@/lib/api/analytics";
import type { OverviewFilters } from "@/lib/filters/schema";
import { readWidget, type StoredWidget, type Widget } from "./model";

export type DashboardData =
  | { source: "overview"; result: OverviewResponse }
  | { source: "events"; result: BehaviorAnalyticsResponse };
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

export function moduleQueryOptions(widget: Widget, filters: OverviewFilters, userId: string) {
  const { from, to, environment, projectId } = filters;
  const base = [
    "dashboard-data",
    userId,
    projectId,
    from.toISOString(),
    to.toISOString(),
    environment ?? "",
  ] as const;
  if (widget.data.source === "overview") {
    const effective = effectiveOverviewFilters(widget, filters);
    return {
      queryKey: [...base, "overview", effective.release ?? "", effective.route ?? ""],
      queryFn: ({ signal }: { signal: AbortSignal }): Promise<DashboardData> =>
        limited(signal, async () => ({
          source: "overview",
          result: await getOverview(effective, signal),
        })),
      staleTime: 30_000,
    };
  }
  const data = widget.data;
  const eventFilters: BehaviorFilters = {
    projectId,
    from,
    to,
    environment,
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
  };
}

export function useDashboardQueries(
  widgets: StoredWidget[],
  filters: OverviewFilters,
  userId: string,
) {
  const options = new Map<string, ReturnType<typeof moduleQueryOptions>>();
  const identities = new Map<string, string>();
  for (const record of widgets) {
    const widget = readWidget(record);
    if (!widget) continue;
    const query = moduleQueryOptions(widget, filters, userId);
    const key = JSON.stringify(query.queryKey);
    options.set(key, query);
    identities.set(widget.id, key);
  }
  const entries = [...options.entries()];
  const results = useQueries({ queries: entries.map(([, query]) => query) });
  const byKey = new Map(entries.map(([key], index) => [key, results[index]]));
  return new Map([...identities].map(([id, key]) => [id, byKey.get(key)!]));
}

export function useModulePreview(widget: Widget, filters: OverviewFilters, userId: string) {
  return useQuery(moduleQueryOptions(widget, filters, userId));
}
