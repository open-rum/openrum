import type { APITrendPoint } from "@/lib/api/apis";
import { categoryColor, OTHER_COLOR } from "@/lib/charts/palette";
import { withPartialEdges } from "@/lib/charts/partialEdges";
import type { PlotData, SeriesDefinition, Unit } from "@/lib/charts/plotData";
import { continuousRows, intervalSeconds } from "@/lib/charts/timeSeries";

// The three charts of API monitoring, as PlotData: how many requests and how many failed,
// how long they took, and what the responses were. Each reads the same trend points, so the
// three always cover the same buckets.

export type ApiTrendRange = { from: string; to: string; interval?: string };

function define(
  key: string,
  label: string,
  unit: Unit,
  color: string,
  extra: Partial<SeriesDefinition> = {},
): SeriesDefinition {
  return { key, label, unit, color, ink: color, ...extra };
}

/** One row per bucket, with absent buckets left as gaps rather than zeroes. */
function rowsOf(
  trend: readonly APITrendPoint[],
  range: ApiTrendRange,
  keys: string[],
  read: (point: APITrendPoint) => Record<string, number | null>,
) {
  const seconds = range.interval ? intervalSeconds(range.interval) : 0;
  const rows = trend.map((point) => ({ label: point.bucket, ...read(point) }));
  return {
    seconds,
    rows: continuousRows(rows, range.from, range.to, seconds, keys),
  };
}

const rangeMs = (range: ApiTrendRange) => Date.parse(range.to) - Date.parse(range.from);

/**
 * Request count on the left axis, failure rate on the right. Failures are 5xx and network
 * failures; a 4xx is the caller's mistake and is shown in the errors chart. The rate is drawn
 * rather than the failure count: next to the request count, a count that is 1% of it is a
 * flat line along the baseline.
 */
export function apiRequestsPlot(trend: readonly APITrendPoint[], range: ApiTrendRange): PlotData {
  const keys = ["requests", "failureRate"];
  const { seconds, rows } = rowsOf(trend, range, keys, (point) => ({
    requests: point.requests,
    failureRate: point.requests ? (point.failures / point.requests) * 100 : null,
  }));
  const {
    rows: plotted,
    series,
    edgeNote,
  } = withPartialEdges({
    rows,
    keys,
    series: [
      define("requests", "请求次数", "count", categoryColor(0)),
      define("failureRate", "失败率", "percent", "var(--ds-danger)", { axis: "right" }),
    ],
    from: range.from,
    to: range.to,
    seconds,
  });
  return {
    kind: "series",
    series,
    rows: plotted,
    intervalSeconds: seconds,
    rangeMs: rangeMs(range),
    note: "按采样事件计数",
    edgeNote,
    empty: trend.every((point) => point.requests === 0),
  };
}

/** Median, P75 and P95 of how long requests took, bucket by bucket. */
export function apiLatencyPlot(trend: readonly APITrendPoint[], range: ApiTrendRange): PlotData {
  const keys = ["p50", "p75", "p95"];
  const { seconds, rows } = rowsOf(trend, range, keys, (point) => ({
    p50: point.p50,
    p75: point.p75,
    p95: point.p95,
  }));
  const {
    rows: plotted,
    series,
    edgeNote,
  } = withPartialEdges({
    rows,
    keys,
    series: [
      define("p50", "P50", "ms", categoryColor(0)),
      define("p75", "P75", "ms", categoryColor(1)),
      define("p95", "P95", "ms", categoryColor(2)),
    ],
    from: range.from,
    to: range.to,
    seconds,
  });
  return {
    kind: "series",
    series,
    rows: plotted,
    intervalSeconds: seconds,
    rangeMs: rangeMs(range),
    note: "各时间桶独立计算分位数",
    edgeNote,
    empty: trend.every((point) => point.p95 === null),
  };
}

/**
 * The responses that were not a success, stacked by class: 4xx, 5xx, or no response at all.
 * Successes are left out: they are nearly every request, so a stack that included them would
 * repeat the request count and squeeze the errors into a sliver at the top.
 */
export function apiErrorsPlot(trend: readonly APITrendPoint[], range: ApiTrendRange): PlotData {
  const keys = ["client", "server", "network"];
  const { seconds, rows } = rowsOf(trend, range, keys, (point) => ({
    client: point.clientErrors,
    server: point.serverErrors,
    network: point.networkErrors,
  }));
  return {
    kind: "series",
    series: [
      define("client", "4xx", "count", "var(--ds-warning)"),
      define("server", "5xx", "count", "var(--ds-danger)"),
      define("network", "网络错误", "count", OTHER_COLOR),
    ],
    rows,
    stacked: true,
    intervalSeconds: seconds,
    rangeMs: rangeMs(range),
    note: "按采样事件计数",
    empty: trend.every((point) => point.requests === 0),
  };
}

/** Whether any request in the range ended in a 4xx, a 5xx or no response. */
export function hasApiErrors(trend: readonly APITrendPoint[]) {
  return trend.some((point) => point.clientErrors + point.serverErrors + point.networkErrors > 0);
}
