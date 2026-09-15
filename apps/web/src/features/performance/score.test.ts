import { describe, expect, it } from "vitest";
import {
  overallPerformanceScore,
  performanceRating,
  performanceScore,
  performanceScoreWeights,
  scoreRating,
  summarizePerformance,
} from "./score";

describe("performance scoring", () => {
  const metric = (p75: number | null, samples = 100) => ({
    p75,
    samples,
    sufficient: samples >= 75,
  });
  it("scores actual overall P75s with the existing curve and Sentry metric weights", () => {
    expect(performanceScoreWeights).toEqual({ LCP: 30, INP: 30, CLS: 15, FCP: 15, TTFB: 10 });
    expect(
      Object.values(performanceScoreWeights).reduce((total, weight) => total + weight, 0),
    ).toBe(100);
    const result = overallPerformanceScore({
      route: "",
      pageViews: 200,
      lcp: metric(2500),
      inp: metric(200),
      cls: metric(0.1),
      fcp: metric(1800),
      ttfb: metric(800),
    });
    expect(result).toMatchObject({ score: 90, complete: true, available: 5 });
    expect(result.metrics.map(({ name }) => name)).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);
  });
  it("marks incomplete and low-sample scores as reference without filling missing metrics", () => {
    const result = overallPerformanceScore({
      route: "",
      pageViews: 200,
      lcp: metric(4000, 20),
      inp: metric(null, 0),
      cls: metric(null, 0),
    });
    expect(result).toMatchObject({ score: 50, complete: false, available: 1 });
    expect(overallPerformanceScore(undefined)).toMatchObject({
      score: null,
      complete: false,
      available: 0,
    });
  });
  it("does not let long-tail percentile values alter the P75 score", () => {
    const summary = {
      route: "",
      pageViews: 200,
      lcp: { ...metric(2500), p95: 8000 },
      inp: { ...metric(200), p95: 2000 },
      cls: { ...metric(0.1), p95: 0.8 },
    };
    expect(overallPerformanceScore(summary).score).toBe(90);
    expect(overallPerformanceScore({ ...summary, lcp: { ...summary.lcp, p95: 12000 } }).score).toBe(
      90,
    );
  });
  it("ignores non-finite and negative samples for scoring", () => {
    expect(
      overallPerformanceScore({
        route: "",
        pageViews: 0,
        lcp: metric(NaN),
        inp: metric(Infinity),
        cls: metric(-1),
      }).score,
    ).toBeNull();
  });
  it("uses the Core Web Vitals P75 boundaries", () => {
    expect(performanceRating(2500, "LCP")).toBe("good");
    expect(performanceRating(2501, "LCP")).toBe("needs-improvement");
    expect(performanceRating(501, "INP")).toBe("poor");
    expect(performanceRating(0.1, "CLS")).toBe("good");
  });
  it("includes FCP and TTFB at their respective weights", () => {
    expect(performanceRating(1800, "FCP")).toBe("good");
    expect(performanceRating(3001, "FCP")).toBe("poor");
    expect(performanceRating(800, "TTFB")).toBe("good");
    expect(performanceRating(1801, "TTFB")).toBe("poor");
    expect(
      overallPerformanceScore({
        route: "",
        pageViews: 100,
        lcp: metric(2500),
        inp: metric(200),
        cls: metric(0.1),
        fcp: metric(9000),
        ttfb: metric(9000),
      }).score,
    ).toBe(68);
  });

  it.each([
    ["lcp", 70],
    ["inp", 70],
    ["cls", 85],
    ["fcp", 85],
    ["ttfb", 90],
  ] as const)(
    "applies the expected weight to %s and requires sufficient samples",
    (key, expected) => {
      const summary = {
        route: "",
        pageViews: 100,
        lcp: metric(0),
        inp: metric(0),
        cls: metric(0),
        fcp: metric(0),
        ttfb: metric(0),
      };
      expect(overallPerformanceScore({ ...summary, [key]: metric(100000) })).toMatchObject({
        score: expected,
        complete: true,
        available: 5,
      });
      expect(overallPerformanceScore({ ...summary, [key]: metric(0, 10) })).toMatchObject({
        score: 100,
        complete: false,
        available: 5,
      });
    },
  );

  it("renormalizes available weights without treating missing metrics as zero", () => {
    const result = overallPerformanceScore({
      route: "",
      pageViews: 100,
      lcp: metric(4000), // 50 points at 30% default weight
      inp: metric(null, 0),
      cls: metric(null, 0),
      ttfb: metric(0), // 100 points at 10% default weight
    });
    expect(result).toMatchObject({ score: 63, complete: false, available: 2 });
    expect(result.metrics.map(({ weight }) => weight)).toEqual([30, 30, 15, 15, 10]);
  });

  it("keeps older three-metric responses as reference scores", () => {
    expect(
      overallPerformanceScore({
        route: "",
        pageViews: 100,
        lcp: metric(2500),
        inp: metric(200),
        cls: metric(0.1),
      }),
    ).toMatchObject({ score: 90, complete: false, available: 3 });
  });

  it("can score FCP and TTFB without core samples and excludes invalid auxiliary values", () => {
    const summary = {
      route: "",
      pageViews: 100,
      lcp: metric(null, 0),
      inp: metric(null, 0),
      cls: metric(null, 0),
      fcp: metric(1800),
      ttfb: metric(800),
    };
    expect(overallPerformanceScore(summary)).toMatchObject({
      score: 90,
      complete: false,
      available: 2,
    });
    expect(
      overallPerformanceScore({ ...summary, fcp: metric(NaN), ttfb: metric(-1) }),
    ).toMatchObject({ score: null, complete: false, available: 0 });
  });

  it("produces a bounded and monotonic score", () => {
    expect(performanceScore(0, "LCP")).toBe(100);
    expect(performanceScore(2500, "LCP")).toBe(90);
    expect(performanceScore(4000, "LCP")).toBe(50);
    expect(performanceScore(9000, "LCP")).toBe(0);
    expect(scoreRating(90)).toBe("good");
  });

  it("weights route scores by samples and prefers sufficient routes", () => {
    const summary = summarizePerformance([
      {
        route: "/products/:id",
        pageViews: 1000,
        lcp: { p75: 2000, samples: 800, sufficient: true },
        inp: { p75: 180, samples: 800, sufficient: true },
        cls: { p75: 0.08, samples: 800, sufficient: true },
      },
      {
        route: "/rare",
        pageViews: 2,
        lcp: { p75: 8000, samples: 2, sufficient: false },
        inp: { p75: 900, samples: 2, sufficient: false },
        cls: { p75: 0.5, samples: 2, sufficient: false },
      },
    ]);
    expect(summary.score).toBeGreaterThanOrEqual(90);
    expect(summary.pageViews).toBe(1002);
    expect(summary.measuredRoutes).toBe(2);
    expect(summary.metrics[0].p75).toBe(2000);
  });
});
