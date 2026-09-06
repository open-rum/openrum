import { describe, expect, it } from "vitest";
import { performanceRating, performanceScore, scoreRating, summarizePerformance } from "./score";

describe("performance scoring", () => {
  it("uses the Core Web Vitals P75 boundaries", () => {
    expect(performanceRating(2500, "LCP")).toBe("good");
    expect(performanceRating(2501, "LCP")).toBe("needs-improvement");
    expect(performanceRating(501, "INP")).toBe("poor");
    expect(performanceRating(0.1, "CLS")).toBe("good");
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
