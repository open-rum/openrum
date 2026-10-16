import { describe, expect, it } from "vitest";
import type { APITrendPoint } from "@/lib/api/apis";
import { apiLatencyPlot, apiRequestsPlot, apiStatusPlot } from "./plotData";

const point = (bucket: string, overrides: Partial<APITrendPoint> = {}): APITrendPoint => ({
  bucket,
  requests: 100,
  failures: 6,
  clientErrors: 10,
  serverErrors: 4,
  networkErrors: 2,
  p50: 80,
  p75: 200,
  p95: 600,
  ...overrides,
});

const range = { from: "2026-10-11T10:00:00Z", to: "2026-10-11T11:00:00Z", interval: "1 HOUR" };
const trend = [point("2026-10-11T10:00:00Z")];

describe("apiRequestsPlot", () => {
  it("reads success rate on its own right-hand axis", () => {
    const plot = apiRequestsPlot(trend, range);
    expect(plot.series.map((series) => [series.key, series.axis ?? "left"])).toEqual([
      ["requests", "left"],
      ["failures", "left"],
      ["successRate", "right"],
    ]);
    expect(plot.rows[0]).toMatchObject({ requests: 100, failures: 6 });
    expect(plot.rows[0].successRate).toBeCloseTo(94, 5);
  });

  it("leaves success rate empty for a bucket with no requests, not 100% or 0%", () => {
    const plot = apiRequestsPlot(
      [point("2026-10-11T10:00:00Z", { requests: 0, failures: 0 })],
      range,
    );
    expect(plot.rows[0].successRate).toBeNull();
  });

  it("flags an empty range", () => {
    expect(apiRequestsPlot([], range).empty).toBe(true);
    expect(apiRequestsPlot(trend, range).empty).toBe(false);
  });
});

describe("apiLatencyPlot", () => {
  it("draws the three percentiles in milliseconds", () => {
    const plot = apiLatencyPlot(trend, range);
    expect(plot.series.map((series) => [series.label, series.unit])).toEqual([
      ["P50", "ms"],
      ["P75", "ms"],
      ["P95", "ms"],
    ]);
    expect(plot.rows[0]).toMatchObject({ p50: 80, p75: 200, p95: 600 });
  });

  it("keeps a missing percentile as a gap", () => {
    const plot = apiLatencyPlot(
      [point("2026-10-11T10:00:00Z", { p50: null, p75: null, p95: null })],
      range,
    );
    expect(plot.rows[0].p95).toBeNull();
    expect(plot.empty).toBe(true);
  });
});

describe("apiStatusPlot", () => {
  it("stacks response classes that add up to the request count", () => {
    const plot = apiStatusPlot(trend, range);
    expect(plot.stacked).toBe(true);
    const row = plot.rows[0];
    expect(row).toMatchObject({ ok: 84, client: 10, server: 4, network: 2 });
    expect(Number(row.ok) + Number(row.client) + Number(row.server) + Number(row.network)).toBe(
      100,
    );
  });

  it("never reports a negative success count when the classes overshoot", () => {
    const plot = apiStatusPlot([point("2026-10-11T10:00:00Z", { requests: 5 })], range);
    expect(plot.rows[0].ok).toBe(0);
  });

  it("pads missing buckets with gaps when the interval is known", () => {
    const wide = { ...range, to: "2026-10-11T13:00:00Z" };
    const plot = apiStatusPlot(trend, wide);
    expect(plot.rows).toHaveLength(3);
    expect(plot.rows[2].ok).toBeNull();
  });
});
