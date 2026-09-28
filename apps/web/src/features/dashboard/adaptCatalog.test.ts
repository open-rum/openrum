import { describe, expect, it } from "vitest";
import type { MetricMeta, MetricsResult } from "@/lib/api/metricsQuery";
import {
  adaptCatalogPlot,
  adaptCatalogStat,
  adaptMetricTable,
  adaptRankedTable,
} from "./adaptCatalog";
import { createCatalogWidget } from "./model";

const meta = (overrides: Partial<MetricMeta>): MetricMeta => ({
  id: "traffic.pageViews",
  label: "PV",
  description: "",
  unit: "count",
  weighting: "estimated",
  kind: "count",
  direction: "up",
  approximate: false,
  additiveOverTime: true,
  additive: true,
  ...overrides,
});

const base = {
  from: "2026-09-02T10:00:00Z",
  to: "2026-09-02T10:30:00Z",
  source: "project",
  limitReached: false,
  freshness: {},
};
const value = (number: number | null, samples = 10) => ({
  value: number,
  samples,
  sufficient: true,
});
const filters = { projectId: "p1", from: new Date(base.from), to: new Date(base.to) };

describe("catalog adapters", () => {
  it("keys series synthetically, keeps null gaps and lays the previous period on the same grid", () => {
    const result: MetricsResult = {
      ...base,
      shape: "series",
      metrics: [
        meta({
          id: "api.durationP95",
          label: "延迟 P95",
          unit: "ms",
          kind: "quantile",
          additive: false,
        }),
      ],
      intervalSeconds: 600,
      buckets: ["2026-09-02T10:00:00Z", "2026-09-02T10:10:00Z", "2026-09-02T10:20:00Z"],
      series: [{ metric: "api.durationP95", points: [value(120), null, value(180)] }],
      previousSeries: [{ metric: "api.durationP95", points: [null, value(90), null] }],
      comparison: { from: "2026-09-02T09:30:00Z", to: "2026-09-02T10:00:00Z", offsetSeconds: 1800 },
    };
    const widget = createCatalogWidget("timeseries", {
      metrics: ["api.durationP95"],
      compare: "previous",
    });
    const plot = adaptCatalogPlot(widget, result);
    expect(plot.series.map((series) => series.key)).toEqual(["m0", "m0__prev"]);
    expect(plot.series[1].role).toBe("previous");
    expect(plot.rows.map((row) => row.m0)).toEqual([120, null, 180]);
    expect(plot.rows.map((row) => row.m0__prev)).toEqual([null, 90, null]);
    expect(plot.series.some((series) => series.key.includes("."))).toBe(false);
  });

  it("shows ratios as percentages and takes the change in points", () => {
    const result: MetricsResult = {
      ...base,
      shape: "series",
      metrics: [
        meta({
          id: "traffic.errorRate",
          unit: "ratio",
          kind: "rate",
          direction: "down",
          additive: false,
        }),
      ],
      totals: { "traffic.errorRate": value(0.05) },
      comparison: {
        ...{ from: base.from, to: base.to, offsetSeconds: 1800 },
        totals: { "traffic.errorRate": value(0.02) },
        changes: { "traffic.errorRate": { points: 3 } },
      },
    };
    const stat = adaptCatalogStat(
      createCatalogWidget("stat", { metrics: ["traffic.errorRate"] }),
      result,
    );
    expect(stat.value).toBeCloseTo(5);
    expect(stat.unit).toBe("percent");
    expect(stat.comparison).toEqual({ change: 3, unit: "points", previous: 2 });
    expect(stat.direction).toBe("down");
  });

  it("adds an Other row only for metrics that add up, and marks rates as not shareable", () => {
    const additive: MetricsResult = {
      ...base,
      shape: "breakdown",
      dimension: "browser",
      metrics: [meta({})],
      rows: [{ value: "Chrome", values: { "traffic.pageViews": value(60) } }],
      other: { "traffic.pageViews": value(40) },
      limitReached: true,
      topN: 1,
    };
    const widget = createCatalogWidget("breakdown", {
      metrics: ["traffic.pageViews"],
      dimension: "browser",
    });
    const bars = adaptCatalogPlot(widget, additive);
    expect(bars.rows.map((row) => row.label)).toEqual(["Chrome", "其他"]);
    expect(bars.distribution?.shareable).toBe(true);
    const rates = adaptCatalogPlot(widget, {
      ...additive,
      metrics: [meta({ id: "traffic.errorRate", unit: "ratio", additive: false })],
      rows: [{ value: "Chrome", values: { "traffic.errorRate": value(0.1) } }],
      other: undefined,
    });
    expect(rates.rows).toHaveLength(1);
    expect(rates.distribution?.shareable).toBe(false);
  });

  it("builds ranked rows with change and sparkline, and metric tables per column", () => {
    const result: MetricsResult = {
      ...base,
      shape: "table",
      dimension: "route",
      metrics: [
        meta({}),
        meta({ id: "traffic.errorRate", label: "错误率", unit: "ratio", additive: false }),
      ],
      rows: [
        {
          value: "/home",
          values: { "traffic.pageViews": value(10), "traffic.errorRate": value(0.5) },
          changes: { "traffic.pageViews": { percent: 25 }, "traffic.errorRate": { points: -1 } },
          sparkline: [value(4), null, value(6)],
        },
      ],
      totals: { "traffic.pageViews": value(40) },
    };
    const ranked = adaptRankedTable({ ...result, metrics: [result.metrics[0]] }, filters);
    expect(ranked.rows[0]).toMatchObject({
      label: "/home",
      current: 10,
      change: 25,
      sparkline: [4, null, 6],
    });
    const matrix = adaptMetricTable(result);
    expect(matrix.columns.map((column) => column.unit)).toEqual(["count", "percent"]);
    expect(matrix.rows[0].cells.m1).toEqual({ value: 50, change: -1, sufficient: true });
  });
});
