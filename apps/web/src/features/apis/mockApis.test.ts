import { describe, expect, it } from "vitest";
import { apiSamplesSchema, apisResponseSchema, type APIFilters } from "@/lib/api/apis";
import { mockAPIs, mockAPISamples } from "./mockApis";

const filters = (patch: Partial<APIFilters> = {}): APIFilters => ({
  projectId: "project-1",
  from: new Date("2026-11-10T00:00:00Z"),
  to: new Date("2026-11-11T00:00:00Z"),
  methods: [],
  sort: "requests",
  ...patch,
});

describe("API preview data", () => {
  it("matches the API response schema and the 30-point trend budget", () => {
    const response = mockAPIs(filters());
    expect(() => apisResponseSchema.parse(response)).not.toThrow();
    expect(response.interval).toBe("1 HOUR");
    expect(response.trend.length).toBeLessThanOrEqual(30);
    expect(response.summary.requests).toBe(
      response.endpoints.reduce((total, endpoint) => total + endpoint.requests, 0),
    );
    expect(response.detail).toBeUndefined();
  });

  it("gives the same numbers for the same filters", () => {
    expect(mockAPIs(filters())).toEqual(mockAPIs(filters()));
  });

  it("follows the sort, search and selected endpoint", () => {
    const byP95 = mockAPIs(filters({ sort: "p95" })).endpoints;
    expect(byP95[0]!.p95).toBeGreaterThanOrEqual(byP95[1]!.p95!);
    expect(
      mockAPIs(filters({ q: "cart" })).endpoints.every((item) => item.url.includes("cart")),
    ).toBe(true);
    const detail = mockAPIs(filters({ method: "POST", url: "/api/checkout" })).detail;
    expect(detail?.endpoint.url).toBe("/api/checkout");
    expect(detail?.statuses.length).toBeGreaterThan(0);
  });

  it("builds request samples for the selected endpoint", () => {
    const selected = filters({ method: "GET", url: "/api/products/:id" });
    const samples = mockAPISamples(selected, "");
    expect(() => apiSamplesSchema.parse(samples)).not.toThrow();
    expect(samples.samples.length).toBeGreaterThan(0);
    expect(samples.samples.every((sample) => sample.method === "GET")).toBe(true);
    expect(
      mockAPISamples(selected, "anon-0001").samples.every(
        (sample) => sample.anonymousUserId === "anon-0001",
      ),
    ).toBe(true);
    expect(mockAPISamples(filters(), "").samples).toEqual([]);
  });
});
