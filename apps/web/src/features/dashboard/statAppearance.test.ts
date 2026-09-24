import { describe, expect, it } from "vitest";
import { createWidget, readWidget, statAppearanceLabels, widgetSchema } from "./model";
import { adaptStat } from "./adapters";
import type { DashboardData } from "./queries";

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
    interval: "1 HOUR",
    totals: metric(5),
    trend: [
      { bucket: "2026-09-02T00:00:00Z", metric: metric(3) },
      { bucket: "2026-09-02T01:00:00Z", metric: metric(4) },
    ],
    catalog: [],
    properties: [],
    measurements: [],
    breakdown: [],
    sampleCount: 10,
    rowLimit: 100,
    freshness: { latestReceivedAt: null, ageSeconds: null, stale: true },
  },
};

describe("Stat appearance contract", () => {
  it("keeps legacy configuration and plain cards unchanged", () => {
    const widget = createWidget("stat");
    expect(readWidget(widget)).toEqual(widget);
    expect(widget.statAppearance).toBeUndefined();
    expect(
      adaptStat(
        { ...widget, data: { source: "events", metrics: ["estimated"], dimension: "country" } },
        data,
      ).trend,
    ).toBeUndefined();
  });
  it("round-trips every supported appearance but rejects unknown or non-Stat options", () => {
    expect(Object.keys(statAppearanceLabels)).toEqual(["plain", "line-right", "bar-right"]);
    for (const statAppearance of Object.keys(statAppearanceLabels)) {
      const widget = { ...createWidget("stat"), statAppearance };
      expect(widgetSchema.parse(JSON.parse(JSON.stringify(widget)))).toEqual(widget);
      expect(
        widgetSchema.safeParse({ ...createWidget("timeseries"), statAppearance }).success,
      ).toBe(false);
    }
    for (const statAppearance of [null, "", "pie", 3]) {
      expect(widgetSchema.safeParse({ ...createWidget("stat"), statAppearance }).success).toBe(
        false,
      );
    }
  });
  it("reads retired bottom appearances as right-side lines without modifying the stored record", () => {
    for (const statAppearance of ["line-bottom", "area-bottom"]) {
      const stored = { ...createWidget("stat"), statAppearance };
      expect(readWidget(stored)?.statAppearance).toBe("line-right");
      expect(stored.statAppearance).toBe(statAppearance);
      expect(
        widgetSchema.safeParse({ ...createWidget("timeseries"), statAppearance }).success,
      ).toBe(false);
    }
  });
  it("uses real time buckets without summing UV buckets into the range aggregate", () => {
    const widget = createWidget("stat", {
      statAppearance: "line-right",
      data: { source: "events", metrics: ["uniqueUsers"], dimension: "country" },
    });
    const adapted = adaptStat(widget, data);
    expect(adapted.value).toBe(5);
    expect(adapted.trend?.rows.slice(0, 2)).toEqual([
      { label: "2026-09-02T00:00:00Z", uniqueUsers: 3 },
      { label: "2026-09-02T01:00:00Z", uniqueUsers: 4 },
    ]);
    expect(adapted.trend?.rows).toHaveLength(24);
    expect(adapted.trend?.rows.slice(2).every((row) => row.uniqueUsers === null)).toBe(true);
    expect(adapted.comparison).toBeUndefined();
    expect(
      adaptStat(widget, { ...data, result: { ...data.result, totals: metric(0), trend: [] } }).trend
        ?.empty,
    ).toBe(true);
  });
});
