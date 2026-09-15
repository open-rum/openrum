import { describe, expect, it } from "vitest";
import { defaultPerformanceFilters, serializePerformanceFilters } from "./performance";
import { parseIssueFilters, serializeIssueFilters } from "./issues";

describe("analysis filter URLs", () => {
  it("round trips combined performance dimensions and percentile", () => {
    const search = new URLSearchParams(
      "from=2026-09-11T00:00:00Z&to=2026-09-12T00:00:00Z&country=cn&deviceType=mobile&route=%2Fproducts%2F%3Aid&release=web%401&browser=Safari&environment=production&metric=FCP&percentile=p95",
    );
    const filters = defaultPerformanceFilters("project", search);
    expect(filters).toMatchObject({
      country: "CN",
      deviceType: "mobile",
      route: "/products/:id",
      release: "web@1",
      browser: "Safari",
      environment: "production",
      metric: "FCP",
      percentile: "p95",
    });
    expect(defaultPerformanceFilters("project", serializePerformanceFilters(filters))).toEqual(
      filters,
    );
  });
  it("restricts the console to three percentiles and accepts TTFB", () => {
    for (const percentile of ["p90", "p99"]) {
      expect(
        defaultPerformanceFilters("project", new URLSearchParams({ percentile, metric: "TTFB" })),
      ).toMatchObject({ percentile: "p75", metric: "TTFB" });
    }
  });
  it("falls back safely for invalid dates and percentiles without mutating the clock", () => {
    const now = new Date("2026-09-12T00:00:34Z");
    const filters = defaultPerformanceFilters(
      "project",
      new URLSearchParams("from=broken&to=Infinity&percentile=p100&metric=FID"),
      now,
    );
    expect(filters.percentile).toBe("p75");
    expect(filters.metric).toBe("LCP");
    expect(filters.to.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(now.toISOString()).toBe("2026-09-12T00:00:34.000Z");
    expect(() => serializePerformanceFilters(filters)).not.toThrow();
  });
  it("preserves route filters on issue list and detail URLs", () => {
    const filters = parseIssueFilters(
      "project",
      new URLSearchParams("route=%2Fcheckout&country=CN&deviceType=desktop"),
    );
    expect(serializeIssueFilters(filters).get("route")).toBe("/checkout");
    expect(parseIssueFilters("project", serializeIssueFilters(filters))).toEqual(filters);
  });
});
