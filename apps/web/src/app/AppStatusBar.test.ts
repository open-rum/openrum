import { describe, expect, it } from "vitest";
import { isPipelineDelayed } from "./pipelineStatus";

describe("isPipelineDelayed", () => {
  it("reports a backlog only when received data is ahead of queryable data", () => {
    expect(isPipelineDelayed(undefined)).toBe(false);
    expect(
      isPipelineDelayed({
        lastEventReceivedAt: "2026-09-15T10:05:00Z",
        lastEventQueryableAt: null,
      }),
    ).toBe(true);
    expect(
      isPipelineDelayed({
        lastEventReceivedAt: "2026-09-15T10:05:00Z",
        lastEventQueryableAt: "2026-09-15T10:04:00Z",
      }),
    ).toBe(false);
    expect(
      isPipelineDelayed({
        lastEventReceivedAt: "2026-09-15T10:05:00Z",
        lastEventQueryableAt: "2026-09-15T10:00:00Z",
      }),
    ).toBe(true);
  });
});
