import { describe, expect, it } from "vitest";
import { adaptPlot, type PlotData } from "./adapters";
import { donutData, donutShare } from "./donutData";
import { createWidget, widgetSchema, withBreakdownDimension } from "./model";
import type { DashboardData } from "./queries";

const metric = (count: number) => ({
  events: count,
  estimated: count,
  uniqueUsers: count,
  uniqueSessions: count,
  approximate: true,
});
const data: DashboardData = {
  source: "events",
  result: {
    from: "2026-09-02T00:00:00Z",
    to: "2026-09-03T00:00:00Z",
    dimension: "country",
    interval: "15 MINUTE",
    totals: metric(9999),
    trend: [],
    catalog: [],
    properties: [],
    measurements: [],
    breakdown: ["CN", "US", "JP", "GB", "DE", "FR", "IN", "BR", "CA", "AU", "SG", "ZZ"].map(
      (value, i) => ({ value, metric: metric(20 - i) }),
    ),
    freshness: { latestReceivedAt: null, ageSeconds: null, stale: true },
    sampleCount: 100,
    rowLimit: 250,
  },
};
const widget = createWidget("breakdown", { view: "donut" });

describe("donut distributions", () => {
  it("only allows donut on event breakdowns and retains it across dimensions", () => {
    for (const dimension of ["country", "device", "browser", "source", "property:plan"]) {
      const next = withBreakdownDimension(widget, dimension);
      expect(next.view).toBe("donut");
      expect(widgetSchema.safeParse(next).success).toBe(true);
    }
    for (const type of ["stat", "timeseries", "top-issues"]) {
      expect(widgetSchema.safeParse({ ...widget, type }).success).toBe(false);
    }
    expect(
      widgetSchema.safeParse({ ...widget, data: { source: "overview", metrics: ["pageViews"] } })
        .success,
    ).toBe(false);
  });
  it("retains all returned groups, combines the tail and does not claim overall totals", () => {
    const plot = adaptPlot(widget, data);
    expect(plot.rows).toHaveLength(12);
    const result = donutData(plot);
    expect(result.items).toHaveLength(6);
    expect(result.items[0].label).toBe("中国 (CN)");
    expect(result.items.at(-1)).toMatchObject({
      label: "其他（7 项）",
      value: 84,
      fill: "var(--ds-chart-10)",
    });
    expect(result.total).toBe(174);
    expect(result.items.reduce((sum, item) => sum + item.value, 0)).toBe(result.total);
    expect(result.items.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1);
    // The ranking renderer limits the compact list, while shares/details retain all groups.
    expect(adaptPlot({ ...widget, view: "bar" }, data).rows).toHaveLength(12);
  });
  it("marks possible truncation and overlapping user counts", () => {
    const plot = adaptPlot(
      { ...widget, data: { source: "events", metrics: ["uniqueUsers"], dimension: "country" } },
      {
        ...data,
        result: { ...data.result, rowLimit: 12 },
      },
    );
    expect(plot.distribution).toMatchObject({
      limitReached: true,
      nonAdditive: true,
      rowLimit: 12,
    });
  });
  it("does not draw zero, missing, negative or non-finite categories", () => {
    const plot: PlotData = {
      ...adaptPlot(widget, data),
      rows: [0, null, -1, NaN, Infinity].map((value) => ({ label: "unknown", estimated: value })),
    };
    expect(donutData(plot)).toEqual({ total: 0, items: [] });
    plot.rows.push({ label: "CN", estimated: 4 });
    expect(donutData(plot).items).toHaveLength(1);
    expect(donutData(plot).items[0].share).toBe(1);
    expect(donutShare(0.00001)).toBe("<0.1%");
  });
  it("does not merge exactly six groups or mutate source rows", () => {
    const plot = adaptPlot(widget, data);
    plot.rows = plot.rows.slice(0, 6).reverse();
    const before = JSON.stringify(plot.rows);
    expect(donutData(plot).items).toHaveLength(6);
    expect(donutData(plot).items.some((item) => item.id === "remainder")).toBe(false);
    expect(JSON.stringify(plot.rows)).toBe(before);
  });
});
