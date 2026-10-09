import { describe, expect, it } from "vitest";
import { combinedTrend } from "./combinedTrend";

describe("combined vital trend", () => {
  const metric = (p75: number | null, p95: number | null = p75, samples = 100) => ({
    p75,
    p95,
    samples,
    sufficient: samples >= 75,
  });
  it("keeps all five metrics in raw units when switching percentile", () => {
    const point = {
      bucket: "2026-09-12T10:00:00Z",
      lcp: metric(2500, 5000),
      inp: metric(200, 600),
      cls: metric(0.1, 0.4),
      fcp: metric(1800, 3200),
      ttfb: metric(800, 1900),
    };
    expect(combinedTrend([point], "p75")[0]).toMatchObject({
      lcp: 2500,
      inp: 200,
      cls: 0.1,
      fcp: 1800,
      ttfb: 800,
    });
    expect(combinedTrend([point], "p95")[0]).toMatchObject({
      lcp: 5000,
      inp: 600,
      cls: 0.4,
      fcp: 3200,
      ttfb: 1900,
      raw: point,
    });
    expect(point.lcp.p75).toBe(2500);
  });
  it("keeps missing, insufficient-count and invalid data as gaps, not zero", () => {
    const point = {
      bucket: "2026-09-12T10:00:00Z",
      lcp: metric(null),
      inp: metric(NaN),
      cls: metric(0.1, 0.2, 0),
    };
    expect(combinedTrend([point], "p75")[0]).toMatchObject({ lcp: null, inp: null, cls: null });
    expect(combinedTrend([point], "p50")[0].cls).toBeNull();
    expect(combinedTrend([point], "p75")[0].fcp).toBeNull();
    expect(combinedTrend([point], "p75")[0].ttfb).toBeNull();
    expect(combinedTrend([], "p75")).toEqual([]);
  });
  it("keeps absent buckets as gaps on the server's interval grid", () => {
    const point = (bucket: string) => ({
      bucket,
      lcp: metric(2500),
      inp: metric(200),
      cls: metric(0.1),
    });
    const rows = combinedTrend(
      [point("2026-09-12T10:00:00.000Z"), point("2026-09-12T13:00:00.000Z")],
      "p75",
      { from: "2026-09-12T10:00:00Z", to: "2026-09-12T14:00:00Z", intervalSeconds: 3600 },
    );
    expect(rows.map((row) => row.lcp)).toEqual([2500, null, null, 2500]);
    expect(rows[1].bucket).toBe("2026-09-12T11:00:00.000Z");
  });
});
