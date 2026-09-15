import { describe, expect, it } from "vitest";
import { createWidget, supportsWorldMap, widgetSchema, withBreakdownDimension } from "./model";
import { adaptPlot } from "./adapters";
import type { DashboardData } from "./queries";

const countries = ["CN", "US", "JP", "GB", "DE", "FR", "IN", "BR", "CA", "AU", "SG", "ZZ"];
const metric = (count: number) => ({
  events: count,
  estimated: count * 2,
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
    totals: metric(100),
    trend: [],
    catalog: [],
    properties: [],
    measurements: [],
    breakdown: countries.map((value, i) => ({ value, metric: metric(20 - i) })),
    freshness: { latestReceivedAt: null, ageSeconds: null, stale: true },
    sampleCount: 100,
    rowLimit: 250,
  },
};

describe("dashboard map contract", () => {
  it("allows map only for country breakdowns", () => {
    const widget = createWidget("breakdown", { view: "map" });
    expect(supportsWorldMap(widget)).toBe(true);
    for (const dimension of ["device", "browser", "source", "property:plan"]) {
      expect(
        widgetSchema.safeParse({ ...widget, data: { ...widget.data, dimension } }).success,
      ).toBe(false);
      const next = withBreakdownDimension(widget, dimension);
      expect(next.view).toBe("bar");
      expect(widgetSchema.safeParse(next).success).toBe(true);
      expect(supportsWorldMap(next)).toBe(false);
    }
    for (const type of ["stat", "timeseries", "top-issues", "slow-apis"]) {
      expect(widgetSchema.safeParse({ ...widget, type }).success).toBe(false);
    }
    expect(withBreakdownDimension(widget, "country").view).toBe("map");
  });
  it("keeps all countries and unknowns for maps while preserving existing Top 10 views", () => {
    const widget = createWidget("breakdown", { view: "map" });
    const plot = adaptPlot(widget, data);
    expect(plot.rows).toHaveLength(12);
    expect(plot.rows.at(-1)).toEqual({ label: "ZZ", estimated: 18 });
    expect(plot.note).toContain("全部 12");
    expect(plot.note).not.toContain("Top 10");
    expect(adaptPlot({ ...widget, view: "bar" }, data).rows).toHaveLength(10);
    expect(adaptPlot({ ...widget, view: "table" }, data).rows).toHaveLength(10);
  });
  it("uses the selected event metric and preserves empty responses", () => {
    const widget = createWidget("breakdown", {
      view: "map",
      data: { source: "events", metrics: ["uniqueUsers"], dimension: "country" },
    });
    const plot = adaptPlot(widget, data);
    expect(plot.rows[0]).toEqual({ label: "CN", uniqueUsers: 20 });
    expect(plot.series[0].label).toBe("用户数");
    if (data.source !== "events") throw Error("fixture");
    expect(
      adaptPlot(widget, { source: "events", result: { ...data.result, breakdown: [] } }).empty,
    ).toBe(true);
  });
});
