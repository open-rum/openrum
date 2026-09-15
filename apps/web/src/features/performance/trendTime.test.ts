import { describe, expect, it } from "vitest";
import { formatTrendDate } from "./trendTime";

describe("performance chart timestamps", () => {
  it.each([undefined, null, NaN, Infinity, 9e20, "LCP P95", {}, "bad-date"])(
    "does not crash for %s",
    (value) => {
      expect(formatTrendDate(value, true)).toBe("—");
    },
  );
  it("formats an actual payload timestamp", () => {
    expect(formatTrendDate("2026-09-12T10:00:00Z", true)).not.toBe("—");
  });
});
