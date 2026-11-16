import { describe, expect, it } from "vitest";
import type { MetricsResult } from "@/lib/api/metricsQuery";
import {
  activeSeriesQuery,
  activeWindow,
  breakdownQuery,
  intensityLevel,
  ordersSeriesQuery,
  percentChange,
  pointsChange,
  rankRegions,
  regionFigures,
  revenueSeriesQuery,
  seriesRatio,
  sourceRows,
} from "./overviewData";
import { formatAmount, formatChange, formatRate } from "./formatOverview";

const scope = {
  projectId: "p1",
  from: new Date("2026-11-01T00:00:00Z"),
  to: new Date("2026-11-08T00:00:00Z"),
  environment: "production",
};
const value = (number: number) => ({ value: number, samples: 1, sufficient: true });
function breakdown(metric: string, rows: Record<string, number>) {
  return {
    rows: Object.entries(rows).map(([key, number]) => ({
      value: key,
      values: { [metric]: value(number) },
    })),
  } as unknown as MetricsResult;
}

describe("overview queries", () => {
  it("reads revenue from purchase's amount with the previous period", () => {
    // One unit per query: the catalog rejects a number and a count on one chart.
    expect(ordersSeriesQuery(scope)).toMatchObject({
      metrics: ["behavior.events"],
      filters: { eventKind: "custom", eventName: "purchase" },
    });
    expect(revenueSeriesQuery(scope)).toMatchObject({
      shape: "series",
      metrics: ["measurement.estimated"],
      measurement: "amount",
      filters: { eventName: "purchase" },
      compare: true,
      maxPoints: 30,
    });
  });

  it("splits sessions by source on page-view sessions, which carry the referrer", () => {
    expect(breakdownQuery(scope, "source", "sessions")).toMatchObject({
      metrics: ["behavior.sessions"],
      filters: { eventKind: "page_view" },
      dimension: "source",
    });
    expect(breakdownQuery(scope, "country", "sessions").metrics).toEqual(["traffic.sessions"]);
  });

  it("covers the last 30 minutes including the current, unfinished one", () => {
    const window = activeWindow(new Date("2026-11-09T10:15:42Z"));
    expect(window.to.toISOString()).toBe("2026-11-09T10:16:00.000Z");
    expect(window.from.toISOString()).toBe("2026-11-09T09:46:00.000Z");
    expect(activeSeriesQuery(scope, new Date("2026-11-09T10:15:42Z"))).toMatchObject({
      metrics: ["behavior.users"],
      maxPoints: 30,
      environment: "production",
    });
  });
});

describe("regions", () => {
  const regions = regionFigures({
    active: breakdown("behavior.users", { CN: 40, US: 12 }),
    sessions: breakdown("traffic.sessions", { CN: 1000, US: 30, unknown: 99, JP: 400 }),
    revenue: breakdown("measurement.estimated", { CN: 5000, JP: 2400 }),
    purchaseSessions: breakdown("behavior.sessions", { CN: 36, US: 3, JP: 12 }),
  });

  it("joins the breakdowns per ISO country and drops unknown", () => {
    expect(regions.map((region) => region.code).sort()).toEqual(["CN", "JP", "US"]);
    expect(regions.find((region) => region.code === "CN")).toEqual({
      code: "CN",
      active: 40,
      sessions: 1000,
      revenue: 5000,
      conversion: 0.036,
    });
  });

  it("leaves conversion out where too few sessions back it", () => {
    expect(regions.find((region) => region.code === "US")?.conversion).toBeNull();
    expect(rankRegions(regions, "conversion").map((region) => region.code)).toEqual(["CN", "JP"]);
  });

  it("ranks by the chosen metric and skips regions without it", () => {
    expect(rankRegions(regions, "revenue").map((region) => region.code)).toEqual(["CN", "JP"]);
    expect(rankRegions(regions, "active").map((region) => region.code)).toEqual(["CN", "US"]);
  });

  it("spreads colour on a square-root scale", () => {
    expect(intensityLevel(0, 100)).toBe(0);
    expect(intensityLevel(100, 100)).toBe(5);
    expect(intensityLevel(4, 100)).toBe(1);
    expect(intensityLevel(25, 100)).toBe(3);
  });
});

describe("comparisons", () => {
  it("compares counts in percent and rates in points", () => {
    expect(percentChange(112, 100)).toEqual({ kind: "percent", value: 12 });
    expect(percentChange(5, 0)).toBeNull();
    expect(pointsChange(0.031, 0.033)?.value).toBeCloseTo(-0.2);
    expect(formatChange({ kind: "percent", value: 12.44 })).toBe("↑ 12.4%");
    expect(formatChange({ kind: "points", value: -0.2 })).toBe("↓ 0.20 个百分点");
    expect(formatChange(null)).toBe("无可比数据");
  });

  it("keeps a bucket with no denominator as a gap", () => {
    expect(seriesRatio([value(10), value(6), null], [value(5), null, value(3)])).toEqual([
      2,
      null,
      null,
    ]);
  });

  it("formats amounts without assuming a currency", () => {
    expect(formatAmount(1_353_000)).toBe("135.3万");
    expect(formatAmount(117.42)).toBe("117.42");
    expect(formatAmount(null)).toBe("—");
    expect(formatRate(0.0312, 2)).toBe("3.12%");
  });

  it("labels amounts with the Project's currency without converting them", () => {
    expect(formatAmount(1_353_000, "CNY")).toBe("¥135.3万");
    expect(formatAmount(117.42, "USD")).toBe("US$117.42");
    expect(formatAmount(-5, "EUR")).toBe("-€5");
    // A code without a symbol is spaced from the number.
    expect(formatAmount(20, "SGD")).toBe("SGD 20");
    expect(formatAmount(null, "USD")).toBe("—");
  });
});

describe("sources", () => {
  it("orders sources by revenue and gives each its share", () => {
    const rows = sourceRows(
      {
        sessions: breakdown("behavior.sessions", { direct: 1000, "google.com": 500, "t.co": 20 }),
        revenue: breakdown("measurement.estimated", { direct: 300, "google.com": 600 }),
        purchaseSessions: breakdown("behavior.sessions", { direct: 30, "google.com": 20 }),
      },
      1000,
    );
    expect(rows.map((row) => row.value)).toEqual(["google.com", "direct", "t.co"]);
    expect(rows[0]).toMatchObject({ share: 0.6, conversion: 0.04, revenuePerSession: 1.2 });
    expect(rows[2]).toMatchObject({ revenue: null, conversion: null, revenuePerSession: 0 });
  });
});
