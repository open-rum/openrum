import { kindLabel } from "@/features/events/catalog";
import type { BehaviorAnalyticsResponse } from "@/lib/api/analytics";
import { categoryColor } from "@/lib/charts/palette";
import type { PlotData, SeriesDefinition } from "@/lib/charts/plotData";
import { withPartialEdges } from "@/lib/charts/partialEdges";
import { continuousRows, intervalSeconds } from "@/lib/charts/timeSeries";

// Turns a behavior-analytics response into the PlotData every Console chart is drawn from, so
// the Events page, the Analysis page and the dashboard share one chart and one look.

function series(key: string, label: string, rank: number, role?: SeriesDefinition["role"]) {
  return {
    key,
    label,
    unit: "count",
    color: categoryColor(rank),
    ink: categoryColor(rank),
    role,
  } as const;
}

/**
 * Events and unique users over time. A bucket that has not run its whole interval (the one
 * still open at the right edge, or one clipped by the range start) is drawn dashed: its lower
 * count is not a drop in traffic.
 */
export function behaviorTrendPlot(result: BehaviorAnalyticsResponse): PlotData {
  const seconds = intervalSeconds(result.interval);
  const keys = ["events", "users"];
  const padded = continuousRows(
    result.trend.map((point) => ({
      label: point.bucket,
      events: point.metric.events,
      users: point.metric.uniqueUsers,
    })),
    result.from,
    result.to,
    seconds,
    keys,
  );
  const {
    rows,
    series: plotted,
    edgeNote,
  } = withPartialEdges({
    rows: padded,
    keys,
    series: [series("events", "事件", 0), series("users", "用户", 1)],
    from: result.from,
    to: result.to,
    seconds,
  });
  return {
    kind: "series",
    series: plotted,
    rows,
    intervalSeconds: seconds,
    rangeMs: Date.parse(result.to) - Date.parse(result.from),
    note: `${result.sampleCount.toLocaleString()} 个采集样本 · 各时间桶独立去重，不能相加作为总数`,
    edgeNote,
    empty: result.totals.events === 0,
  };
}

/** The breakdown for whichever dimension the response was computed for. */
export function behaviorBreakdownPlot(
  result: BehaviorAnalyticsResponse,
  limit = result.breakdown.length,
): PlotData {
  const rows = result.breakdown.slice(0, limit).map((item) => ({
    label: item.value || "未知",
    events: item.metric.events,
  }));
  return {
    kind: "categories",
    series: [series("events", "事件", 0)],
    rows,
    note: `已返回 ${result.breakdown.length} 个分组 · 查询上限 ${result.rowLimit} 组`,
    empty: rows.length === 0,
    distribution: {
      dimension: result.dimension,
      limitReached: result.breakdown.length >= result.rowLimit,
      rowLimit: result.rowLimit,
      nonAdditive: false,
    },
  };
}

/** What kinds of event make up the range: page views, navigations, clicks, custom events. */
export function behaviorKindPlot(result: BehaviorAnalyticsResponse): PlotData {
  const totals = new Map<string, number>();
  for (const entry of result.catalog) {
    totals.set(entry.kind, (totals.get(entry.kind) ?? 0) + entry.metric.events);
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  return {
    kind: "categories",
    series: [series("events", "事件", 0)],
    rows: ordered.map(([kind, events]) => ({ label: kindLabel(kind), key: kind, events })),
    note: "全部事件的类型构成",
    empty: ordered.length === 0,
    distribution: {
      dimension: "kind",
      limitReached: false,
      rowLimit: ordered.length,
      nonAdditive: false,
    },
  };
}
