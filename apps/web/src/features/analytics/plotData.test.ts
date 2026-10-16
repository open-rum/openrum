import { describe, expect, it } from "vitest";
import type { BehaviorAnalyticsResponse } from "@/lib/api/analytics";
import { behaviorBreakdownPlot, behaviorKindPlot, behaviorTrendPlot } from "./plotData";

const metric = (events: number, users = events) => ({
  events,
  estimated: events,
  uniqueUsers: users,
  uniqueSessions: users,
  approximate: true,
});

function response(overrides: Partial<BehaviorAnalyticsResponse> = {}): BehaviorAnalyticsResponse {
  return {
    from: "2026-10-11T10:00:00Z",
    to: "2026-10-11T10:15:00Z",
    dimension: "country",
    interval: "5 MINUTE",
    totals: metric(300, 90),
    trend: [
      { bucket: "2026-10-11T10:00:00Z", metric: metric(120, 40) },
      { bucket: "2026-10-11T10:05:00Z", metric: metric(130, 42) },
      { bucket: "2026-10-11T10:10:00Z", metric: metric(50, 20) },
    ],
    breakdown: [
      { value: "CN", metric: metric(200) },
      { value: "US", metric: metric(100) },
    ],
    catalog: [
      { kind: "click", name: "click", metric: metric(160, 50) },
      { kind: "custom", name: "order_completed", metric: metric(100, 30) },
      { kind: "custom", name: "view_cart", metric: metric(40, 20) },
    ],
    properties: [],
    measurements: [],
    freshness: { latestReceivedAt: "2026-10-11T10:14:00Z", ageSeconds: 30, stale: false },
    sampleCount: 300,
    rowLimit: 12,
    ...overrides,
  };
}

describe("behaviorTrendPlot", () => {
  it("draws events and users as two plain series when every bucket is whole", () => {
    const plot = behaviorTrendPlot(response());
    expect(plot.series.map((series) => series.key)).toEqual(["events", "users"]);
    expect(plot.edgeNote).toBeUndefined();
    expect(plot.rows.map((row) => row.events)).toEqual([120, 130, 50]);
    expect(plot.intervalSeconds).toBe(300);
  });

  it("moves the still-running last bucket onto a dashed partial series, joined to the one before", () => {
    const plot = behaviorTrendPlot(response({ to: "2026-10-11T10:12:00Z" }));
    expect(plot.series.map((series) => [series.key, series.role])).toEqual([
      ["events", undefined],
      ["users", undefined],
      ["events__partial", "partial"],
      ["users__partial", "partial"],
    ]);
    expect(plot.rows.map((row) => row.events)).toEqual([120, 130, null]);
    expect(plot.rows.map((row) => row.events__partial)).toEqual([null, 130, 50]);
    expect(plot.rows.map((row) => row.users__partial)).toEqual([null, 42, 20]);
    expect(plot.edgeNote).toContain("5 分钟");
  });

  it("marks a first bucket that starts before the range", () => {
    const plot = behaviorTrendPlot(
      response({ from: "2026-10-11T10:03:00Z", to: "2026-10-11T10:15:00Z" }),
    );
    expect(plot.rows.map((row) => row.events)).toEqual([null, 130, 50]);
    expect(plot.rows.map((row) => row.events__partial)).toEqual([120, 130, null]);
  });

  it("does not call an empty bucket at the edge partial", () => {
    const plot = behaviorTrendPlot(
      response({
        to: "2026-10-11T10:12:00Z",
        trend: [
          { bucket: "2026-10-11T10:00:00Z", metric: metric(120, 40) },
          { bucket: "2026-10-11T10:05:00Z", metric: metric(130, 42) },
        ],
      }),
    );
    expect(plot.edgeNote).toBeUndefined();
    expect(plot.series.map((series) => series.key)).toEqual(["events", "users"]);
    expect(plot.rows.map((row) => row.events)).toEqual([120, 130, null]);
  });

  it("leaves gaps as nulls and flags an empty range", () => {
    const plot = behaviorTrendPlot(response({ trend: [], totals: metric(0) }));
    expect(plot.empty).toBe(true);
  });
});

describe("the category plots", () => {
  it("lists the breakdown in the response's dimension and honours a limit", () => {
    const plot = behaviorBreakdownPlot(response(), 1);
    expect(plot.rows).toEqual([{ label: "CN", events: 200 }]);
    expect(plot.distribution).toMatchObject({ dimension: "country", limitReached: false });
    expect(plot.note).toContain("2 个分组");
  });

  it("flags a breakdown that hit the server's row limit", () => {
    const plot = behaviorBreakdownPlot(response({ rowLimit: 2 }));
    expect(plot.distribution?.limitReached).toBe(true);
  });

  it("sums the catalog by event type, largest first, keyed by the type", () => {
    const plot = behaviorKindPlot(response());
    expect(plot.rows).toEqual([
      { label: "元素点击", key: "click", events: 160 },
      { label: "自定义事件", key: "custom", events: 140 },
    ]);
  });
});
