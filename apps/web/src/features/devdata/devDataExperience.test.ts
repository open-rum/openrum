import { describe, expect, it } from "vitest";
import { devDataRangeError, devDataDestination } from "./devDataExperience";

describe("generation range validation", () => {
  const now = new Date("2026-11-17T02:00:00Z").getTime();
  it("accepts the API boundary and rejects older, future, reversed, and invalid dates", () => {
    expect(devDataRangeError(new Date(now - 30 * 86400000), new Date(now), now)).toBeNull();
    expect(devDataRangeError(new Date(now - 30 * 86400000 - 1), new Date(now), now)).not.toBeNull();
    expect(devDataRangeError(new Date(now), new Date(now + 60001), now)).not.toBeNull();
    expect(devDataRangeError(new Date(now), new Date(now - 1000), now)).not.toBeNull();
    expect(devDataRangeError(new Date(NaN), new Date(now), now)).not.toBeNull();
  });
  it("returns to the feature list from detail pages, with safe defaults for other pages", () => {
    expect(devDataDestination("/projects/p1/issues/issue1")).toEqual({
      page: "issues",
      label: "查看错误",
      preset: "error-burst",
    });
    expect(devDataDestination("/settings/project/p1/general").page).toBe("overview");
  });
});
