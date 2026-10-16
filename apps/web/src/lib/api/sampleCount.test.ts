import { describe, expect, it } from "vitest";
import { API_SAMPLE_LIMIT, sampleCountLabel } from "./apis";

describe("sampleCountLabel", () => {
  it("shows the exact number while the list can hold every request", () => {
    expect(sampleCountLabel(1)).toBe("1");
    expect(sampleCountLabel(37)).toBe("37");
    expect(sampleCountLabel(API_SAMPLE_LIMIT)).toBe(String(API_SAMPLE_LIMIT));
  });

  it("caps at the list limit, so the tab never promises more rows than the list holds", () => {
    expect(sampleCountLabel(API_SAMPLE_LIMIT + 1)).toBe(`${API_SAMPLE_LIMIT}+`);
    expect(sampleCountLabel(120_000)).toBe(`${API_SAMPLE_LIMIT}+`);
  });

  it("says nothing for an endpoint with no requests", () => {
    expect(sampleCountLabel(0)).toBeUndefined();
    expect(sampleCountLabel(-3)).toBeUndefined();
    expect(sampleCountLabel(Number.NaN)).toBeUndefined();
  });

  it("rounds an estimate that is not a whole number", () => {
    expect(sampleCountLabel(36.6)).toBe("37");
  });
});
