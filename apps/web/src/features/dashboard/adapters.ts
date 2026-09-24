import type { OverviewResponse } from "@/lib/api/client";
import type { BehaviorAnalyticsResponse } from "@/lib/api/analytics";
import type { OverviewFilters } from "@/lib/filters/schema";
import { metricLabel, type Widget } from "./model";
import { effectiveOverviewFilters, type DashboardData } from "./queries";
import { continuousRows, intervalSeconds } from "./chartDensity";

type Unit = "count" | "percent" | "ms" | "score";
export type ScalarData = {
  kind: "scalar";
  value: number | null;
  unit: Unit;
  detail: string;
  comparison?: { change: number | null; unit: "percent" | "points"; previous: number | null };
  insufficient?: boolean;
  trend?: PlotData;
};
export type SeriesDefinition = {
  key: string;
  label: string;
  unit: Unit;
  color: string;
  ink: string;
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
  distribution?: {
    dimension: string;
    limitReached: boolean;
    rowLimit: number;
    nonAdditive: boolean;
  };
};
export type AdaptedData =
  | ScalarData
  | PlotData
  | { kind: "issues"; issues: OverviewResponse["topIssues"]; filters: OverviewFilters }
  | { kind: "apis"; apis: OverviewResponse["slowApis"]; filters: OverviewFilters };

const counts = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });
export function formatMetric(value: number | null, unit: Unit): string {
  if (value === null) return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "score") return value.toFixed(3);
  if (unit === "ms")
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  return counts.format(value);
}

/** Detail tables retain full counts and milliseconds, without compact-unit rounding. */
export function formatDetailedMetric(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "count" || unit === "ms") {
    const number = value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    return unit === "ms" ? `${number} ms` : number;
  }
  return formatMetric(value, unit);
}

function definition(widget: Widget, key: string, index: number): SeriesDefinition {
  const unit = widget.data.source === "overview" ? unitFor(key) : "count";
  const semantic =
    key === "errorRate"
      ? "var(--ds-danger)"
      : key === "apiFailureRate"
        ? "var(--ds-warning)"
        : undefined;
  return {
    key,
    label: metricLabel(widget.data, key),
    unit,
    color: semantic ?? `var(--ds-chart-${(index % 4) + 1})`,
    ink: semantic ?? `var(--ds-chart-${(index % 4) + 1})`,
  };
}
function unitFor(metric: string): Unit {
  return metric === "errorRate" || metric === "apiFailureRate"
    ? "percent"
    : metric === "lcp" || metric === "inp"
      ? "ms"
      : metric === "cls"
        ? "score"
        : "count";
}
function overviewValue(kpis: OverviewResponse["kpis"], metric: string): number | null {
  switch (metric) {
    case "pageViews":
      return kpis.pageViews.value;
    case "uniqueUsers":
      return kpis.uniqueUsers.value;
    case "errorRate":
      return kpis.errorRate.value === null ? null : kpis.errorRate.value * 100;
    case "apiFailureRate":
      return kpis.apiFailureRate.value === null ? null : kpis.apiFailureRate.value * 100;
    case "lcp":
    case "inp":
    case "cls":
      return kpis[metric].p75;
    default:
      return null;
  }
}

export function adaptStat(widget: Widget, data: DashboardData): ScalarData {
  const metric = widget.data.metrics[0];
  const trend =
    widget.statAppearance && widget.statAppearance !== "plain"
      ? adaptPlot(widget, data)
      : undefined;
  if (data.source === "events") {
    const { totals } = data.result;
    return {
      kind: "scalar",
      trend,
      value: eventValue(totals, metric),
      unit: "count",
      detail: `${totals.events.toLocaleString()} 个采集样本${metric === "estimated" ? " · 采样估算" : totals.approximate ? " · 近似去重" : ""}`,
    };
  }
  const { kpis, comparison } = data.result;
  const changes: Record<string, number | null> = {
    pageViews: comparison.changes.pageViewsPercent,
    uniqueUsers: comparison.changes.uniqueUsersPercent,
    errorRate: comparison.changes.errorRatePoints,
    apiFailureRate: comparison.changes.apiFailureRatePoints,
    lcp: comparison.changes.lcpPercent,
    inp: comparison.changes.inpPercent,
    cls: comparison.changes.clsPercent,
  };
  let detail = "";
  let insufficient = false;
  if (metric === "pageViews")
    detail = `${kpis.pageViews.samples.toLocaleString()} 个采集样本 · 采样估算`;
  else if (metric === "uniqueUsers")
    detail = `${kpis.uniqueUsers.samples.toLocaleString()} 个会话样本${kpis.uniqueUsers.approximate ? " · 近似去重" : ""}`;
  else if (metric === "errorRate")
    detail = `${counts.format(kpis.errorRate.numerator)} 错误 / ${counts.format(kpis.errorRate.denominator)} PV`;
  else if (metric === "apiFailureRate")
    detail = `${kpis.apiFailureRate.numeratorSamples.toLocaleString()} 失败 / ${kpis.apiFailureRate.denominatorSamples.toLocaleString()} 请求`;
  else if (metric === "lcp" || metric === "inp" || metric === "cls") {
    detail = `${kpis[metric].samples.toLocaleString()} 个样本`;
    insufficient = !kpis[metric].sufficient;
  }
  return {
    kind: "scalar",
    trend,
    value: overviewValue(kpis, metric),
    unit: unitFor(metric),
    detail,
    insufficient,
    comparison: {
      change: changes[metric] ?? null,
      unit: unitFor(metric) === "percent" ? "points" : "percent",
      previous: overviewValue(comparison.previous, metric),
    },
  };
}

function eventValue(metric: BehaviorAnalyticsResponse["totals"], key: string): number {
  if (key === "uniqueUsers") return metric.uniqueUsers;
  if (key === "uniqueSessions") return metric.uniqueSessions;
  return metric.estimated;
}

export function adaptPlot(widget: Widget, data: DashboardData): PlotData {
  const series = widget.data.metrics.map((key, index) => definition(widget, key, index));
  if (data.source === "events") {
    const metric = widget.data.metrics[0];
    if (widget.type === "breakdown") {
      const rows = [...data.result.breakdown]
        .sort((a, b) => eventValue(b.metric, metric) - eventValue(a.metric, metric))
        .slice(0, widget.view === "table" ? 10 : undefined)
        .map((point) => ({
          label: point.value || "未知",
          [metric]: eventValue(point.metric, metric),
        }));
      return {
        kind: "categories",
        rows,
        series,
        note: `${widget.view === "map" ? `全部 ${rows.length} 个国家/地区分组 · 查询上限 ${data.result.rowLimit} 组` : widget.view === "donut" || widget.view === "bar" ? `已返回 ${rows.length} 个分组 · 查询上限 ${data.result.rowLimit} 组` : "Top 10"} · ${data.result.sampleCount.toLocaleString()} 个采集样本${data.result.totals.approximate ? " · 近似统计" : ""} · 用户与会话可能跨分组重复`,
        empty: rows.length === 0,
        distribution: {
          dimension: data.result.dimension,
          limitReached: data.result.breakdown.length >= data.result.rowLimit,
          rowLimit: data.result.rowLimit,
          nonAdditive: metric !== "estimated",
        },
      };
    }
    return {
      kind: "series",
      series,
      intervalSeconds: intervalSeconds(data.result.interval),
      rangeMs: Date.parse(data.result.to) - Date.parse(data.result.from),
      rows: continuousRows(
        data.result.trend.map((point) => ({
          label: point.bucket,
          [metric]: eventValue(point.metric, metric),
        })),
        data.result.from,
        data.result.to,
        intervalSeconds(data.result.interval),
        [metric],
      ),
      note: `${data.result.sampleCount.toLocaleString()} 个采集样本 · ${metric === "estimated" ? "事件次数按采样率估算" : "各时间桶独立去重，不能相加作为总数"}`,
      empty: data.result.totals.events === 0,
    };
  }
  const { result } = data;
  const key = widget.data.metrics[0];
  const vital = key === "lcp" || key === "inp" || key === "cls";
  const thresholds =
    key === "lcp"
      ? { good: 2500, poor: 4000 }
      : key === "inp"
        ? { good: 200, poor: 500 }
        : key === "cls"
          ? { good: 0.1, poor: 0.25 }
          : undefined;
  const empty = widget.data.metrics.every((metric) => {
    if (metric === "pageViews") return result.kpis.pageViews.samples === 0;
    if (metric === "uniqueUsers") return result.kpis.uniqueUsers.samples === 0;
    if (metric === "errorRate" || metric === "apiFailureRate")
      return result.kpis[metric].denominatorSamples === 0;
    return metric === "lcp" || metric === "inp" || metric === "cls"
      ? result.kpis[metric].samples === 0
      : true;
  });
  return {
    kind: "series",
    series,
    intervalSeconds: result.intervalSeconds,
    rangeMs: Date.parse(result.to) - Date.parse(result.from),
    thresholds,
    empty,
    rows: continuousRows(
      result.series.map((point) => {
        const row: Record<string, string | number | null> = { label: point.bucket };
        for (const metric of widget.data.metrics) row[metric] = overviewValue(point, metric);
        if (vital) row.samples = point[key].samples;
        return row;
      }),
      result.from,
      result.to,
      result.intervalSeconds,
      widget.data.metrics,
    ),
    note: vital
      ? `${result.kpis[key].samples.toLocaleString()} 个样本 · ${result.kpis[key].sufficient ? "每个时间桶独立计算 P75" : "样本不足，谨慎解读 P75"}`
      : key === "errorRate" || key === "apiFailureRate"
        ? "无流量的时间桶留空，不记为 0%"
        : "PV 按采样率估算 · UV 近似去重，各时间桶不能相加作为总 UV",
  };
}

export function adaptList(
  widget: Widget,
  data: DashboardData,
  filters: OverviewFilters,
): AdaptedData {
  if (data.source !== "overview") throw new Error("列表需要概览数据");
  const effective = effectiveOverviewFilters(widget, filters);
  return widget.type === "top-issues"
    ? { kind: "issues", issues: data.result.topIssues, filters: effective }
    : { kind: "apis", apis: data.result.slowApis, filters: effective };
}
