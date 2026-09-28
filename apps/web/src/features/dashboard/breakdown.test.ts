import { describe, expect, it } from "vitest";
import { createWidget, widgetSchema, withBreakdownDimension } from "./model";
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

describe("dashboard breakdown contract", () => {
  it("reads a retired world map as ranked bars", () => {
    const widget = { ...createWidget("breakdown"), view: "map" };
    const parsed = widgetSchema.parse({
      ...widget,
      data: { source: "events", metrics: ["estimated"], dimension: "country" },
    });
    expect(parsed.view).toBe("bar");
    // Even one saved on a dimension the map never supported still loads.
    expect(
      widgetSchema.parse({
        ...widget,
        data: { source: "events", metrics: ["estimated"], dimension: "device" },
      }).view,
    ).toBe("bar");
  });

  it("changes dimension without changing the view", () => {
    const widget = createWidget("breakdown", { view: "donut" });
    for (const dimension of ["device", "browser", "source", "property:plan", "country"]) {
      const next = withBreakdownDimension(widget, dimension);
      expect(next.view).toBe("donut");
      expect(widgetSchema.safeParse(next).success).toBe(true);
    }
  });

  it("keeps every returned country in rankings while the table shows the Top 10", () => {
    const widget = createWidget("breakdown", { view: "bar" });
    const plot = adaptPlot(widget, data);
    expect(plot.rows).toHaveLength(12);
    expect(plot.rows.at(-1)).toEqual({ label: "ZZ", estimated: 18 });
    expect(adaptPlot({ ...widget, view: "table" }, data).rows).toHaveLength(10);
  });

  it("uses the selected event metric and preserves empty responses", () => {
    const widget = createWidget("breakdown", {
      view: "bar",
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
