import type { MetricMeta, MetricsResult, MetricValue } from "@/lib/api/metricsQuery";
import { categoryColor, OTHER_COLOR, seriesColor } from "@/lib/charts/palette";
import { countryGroupLabel } from "@/features/filters/dimensionLabels";
import type { OverviewFilters } from "@/lib/filters/schema";
import type { Widget } from "./model";
import type { PlotData, ScalarData, SeriesDefinition, Unit } from "./adapters";

// Recharts reads a dot in a dataKey as a nested path, and ChartContainer turns config keys
// into CSS custom properties. Metric ids ("api.durationP95") and group values ("/a.html")
// would break both, so every series is keyed synthetically (m0, g0, g_other, m0__prev) and
// keeps its real id and label in the series definition.
export const metricKey = (index: number) => `m${index}`;
export const groupKey = (index: number) => `g${index}`;
export const OTHER_KEY = "g_other";
export const previousKey = (key: string) => `${key}__prev`;

/** Ratios travel as fractions and are shown as percentages. */
export function catalogUnit(meta: Pick<MetricMeta, "unit">): Unit {
  return meta.unit === "ratio" ? "percent" : meta.unit;
}

export function scaled(meta: Pick<MetricMeta, "unit">, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return meta.unit === "ratio" ? value * 100 : value;
}

function pointValue(meta: MetricMeta, point: MetricValue | null | undefined) {
  return point ? scaled(meta, point.value) : null;
}

function groupLabel(dimension: string | undefined, value: string) {
  if (value === "unknown") return "未知";
  return dimension === "country" ? countryGroupLabel(value) : value;
}

function samplesNote(result: MetricsResult) {
  const meta = result.metrics[0];
  const total = result.totals?.[meta.id];
  const parts: string[] = [];
  if (total) parts.push(`${total.samples.toLocaleString()} 个样本`);
  if (meta.weighting === "estimated") parts.push("按采样率还原");
  if (meta.approximate) parts.push("近似统计");
  if (!meta.additiveOverTime && result.shape !== "breakdown" && result.shape !== "table")
    parts.push("各时间桶独立计算，不能相加作为总数");
  if (result.newIssuesLookbackFrom) parts.push("新增 = 首次出现或沉寂 30 天后复发");
  return parts.join(" · ");
}

export function adaptCatalogStat(widget: Widget, result: MetricsResult): ScalarData {
  const meta = result.metrics[0];
  const total = result.totals?.[meta.id];
  const unit = catalogUnit(meta);
  const ratio = meta.unit === "ratio";
  const change = result.comparison?.changes?.[meta.id];
  const trend =
    widget.statAppearance && widget.statAppearance !== "plain"
      ? adaptCatalogPlot(widget, result)
      : undefined;
  return {
    kind: "scalar",
    trend,
    value: scaled(meta, total?.value),
    unit,
    direction: meta.direction,
    detail: samplesNote(result),
    insufficient: Boolean(total && meta.minSamples && !total.sufficient),
    comparison: result.comparison
      ? {
          change: (ratio ? change?.points : change?.percent) ?? null,
          unit: ratio ? "points" : "percent",
          previous: scaled(meta, result.comparison.totals?.[meta.id]?.value),
        }
      : undefined,
  };
}

export function adaptCatalogPlot(widget: Widget, result: MetricsResult): PlotData {
  const stacked = widget.view === "stacked-area" || widget.view === "stacked-bar";
  const rangeMs = Date.parse(result.to) - Date.parse(result.from);
  const buckets = result.buckets ?? [];

  if (result.shape === "seriesByDimension") {
    const meta = result.metrics[0];
    const groups = result.groups ?? [];
    const series: SeriesDefinition[] = groups.map((group, index) => {
      const color = group.other ? OTHER_COLOR : categoryColor(index);
      return {
        key: group.other ? OTHER_KEY : groupKey(index),
        label: group.other ? "其他" : groupLabel(result.dimension, group.value),
        unit: catalogUnit(meta),
        color,
        ink: color,
        role: group.other ? "other" : "current",
      };
    });
    const rows = buckets.map((bucket, at) => {
      const row: Record<string, string | number | null> = { label: bucket };
      groups.forEach((group, index) => {
        row[series[index].key] = pointValue(meta, group.points[at]);
      });
      return row;
    });
    return {
      kind: "series",
      series,
      rows,
      intervalSeconds: result.intervalSeconds,
      rangeMs,
      stacked,
      empty: !groups.length || rows.every((row) => series.every((s) => row[s.key] === null)),
      note: `${samplesNote(result)}${result.limitReached ? ` · 仅展示 Top ${result.topN ?? groups.length}${meta.additive ? "，其余合并为「其他」" : ""}` : ""}`,
    };
  }

  if (result.shape === "breakdown" || result.shape === "table") {
    const meta = result.metrics[0];
    const rows: Array<Record<string, string | number | null>> = (result.rows ?? []).map((row) => ({
      label: groupLabel(result.dimension, row.value),
      [metricKey(0)]: scaled(meta, row.values[meta.id]?.value),
    }));
    const other = result.other?.[meta.id];
    // "Other" makes the shares add up to the whole.
    if (other) rows.push({ label: "其他", [metricKey(0)]: scaled(meta, other.value) });
    const color = seriesColor(0, meta.semantic);
    return {
      kind: "categories",
      rows,
      series: [
        { key: metricKey(0), label: meta.label, unit: catalogUnit(meta), color, ink: color },
      ],
      note: `${samplesNote(result)} · 已返回 ${result.rows?.length ?? 0} 个分组${result.limitReached ? `（上限 ${result.topN}）` : ""}`,
      empty: rows.length === 0,
      distribution: {
        dimension: result.dimension ?? "",
        limitReached: result.limitReached,
        rowLimit: result.topN ?? rows.length,
        nonAdditive: !meta.additive,
        shareable: meta.additive,
      },
    };
  }

  // A plain series: one line per metric, and a dashed previous period behind each.
  const series: SeriesDefinition[] = result.metrics.map((meta, index) => {
    const color = stacked ? categoryColor(index) : seriesColor(index, meta.semantic);
    return {
      key: metricKey(index),
      label: meta.label,
      unit: catalogUnit(meta),
      color,
      ink: color,
      role: "current",
    };
  });
  const previous = result.previousSeries ?? [];
  const comparison: SeriesDefinition[] = previous.length
    ? result.metrics.map((meta, index) => ({
        key: previousKey(metricKey(index)),
        label: result.metrics.length > 1 ? `${meta.label}（上一周期）` : "上一周期",
        unit: catalogUnit(meta),
        color: "var(--ds-chart-comparison)",
        ink: "var(--ds-chart-comparison)",
        role: "previous" as const,
      }))
    : [];
  const rows = buckets.map((bucket, at) => {
    const row: Record<string, string | number | null> = { label: bucket };
    result.metrics.forEach((meta, index) => {
      const points = result.series?.find((entry) => entry.metric === meta.id)?.points ?? [];
      row[metricKey(index)] = pointValue(meta, points[at]);
      if (comparison.length) {
        const before = previous.find((entry) => entry.metric === meta.id)?.points ?? [];
        row[previousKey(metricKey(index))] = pointValue(meta, before[at]);
      }
      const samples = points[at]?.samples;
      if (result.metrics.length === 1 && meta.minSamples && samples !== undefined)
        row.samples = samples;
    });
    return row;
  });
  const only = result.metrics.length === 1 ? result.metrics[0] : undefined;
  return {
    kind: "series",
    series: [...series, ...comparison],
    rows,
    intervalSeconds: result.intervalSeconds,
    rangeMs,
    stacked,
    thresholds: only?.thresholds,
    comparison: result.comparison
      ? { from: result.comparison.from, to: result.comparison.to }
      : undefined,
    empty: rows.every((row) => series.every((s) => row[s.key] === null)),
    note: samplesNote(result),
  };
}

export type RankedRow = {
  value: string;
  label: string;
  current: number | null;
  previous: number | null;
  change: number | null;
  sparkline: Array<number | null>;
  sufficient: boolean;
};

export type RankedData = {
  kind: "ranked";
  meta: MetricMeta;
  unit: Unit;
  ratio: boolean;
  dimension: string;
  rows: RankedRow[];
  total: number | null;
  shareable: boolean;
  limitReached: boolean;
  topN: number;
  note: string;
  filters: OverviewFilters;
};

/** One metric, ranked by group, with its change and a trend per row. */
export function adaptRankedTable(result: MetricsResult, filters: OverviewFilters): RankedData {
  const meta = result.metrics[0];
  const ratio = meta.unit === "ratio";
  return {
    kind: "ranked",
    meta,
    unit: catalogUnit(meta),
    ratio,
    dimension: result.dimension ?? "",
    rows: (result.rows ?? []).map((row) => {
      const change = row.changes?.[meta.id];
      return {
        value: row.value,
        label: groupLabel(result.dimension, row.value),
        current: scaled(meta, row.values[meta.id]?.value),
        previous: scaled(meta, row.previous?.[meta.id]?.value),
        change: (ratio ? change?.points : change?.percent) ?? null,
        sparkline: (row.sparkline ?? []).map((point) => pointValue(meta, point)),
        sufficient: row.values[meta.id]?.sufficient ?? true,
      };
    }),
    total: scaled(meta, result.totals?.[meta.id]?.value),
    shareable: meta.additive,
    limitReached: result.limitReached,
    topN: result.topN ?? 0,
    note: samplesNote(result),
    filters,
  };
}

export type MatrixColumn = { key: string; meta: MetricMeta; unit: Unit };
export type MatrixCell = { value: number | null; change: number | null; sufficient: boolean };
export type MatrixData = {
  kind: "matrix";
  dimension: string;
  columns: MatrixColumn[];
  rows: Array<{ value: string; label: string; cells: Record<string, MatrixCell> }>;
  limitReached: boolean;
  topN: number;
  note: string;
};

/** Several metrics side by side per group. Columns keep their own units. */
export function adaptMetricTable(result: MetricsResult): MatrixData {
  const columns = result.metrics.map((meta, index) => ({
    key: metricKey(index),
    meta,
    unit: catalogUnit(meta),
  }));
  return {
    kind: "matrix",
    dimension: result.dimension ?? "",
    columns,
    rows: (result.rows ?? []).map((row) => ({
      value: row.value,
      label: groupLabel(result.dimension, row.value),
      cells: Object.fromEntries(
        columns.map(({ key, meta }) => {
          const change = row.changes?.[meta.id];
          return [
            key,
            {
              value: scaled(meta, row.values[meta.id]?.value),
              change: (meta.unit === "ratio" ? change?.points : change?.percent) ?? null,
              sufficient: row.values[meta.id]?.sufficient ?? true,
            },
          ];
        }),
      ),
    })),
    limitReached: result.limitReached,
    topN: result.topN ?? 0,
    note: samplesNote(result),
  };
}
