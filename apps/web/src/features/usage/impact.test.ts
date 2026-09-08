import { describe, expect, it } from "vitest";
import { calculateSamplingImpact } from "./impact";
import type { UsageResponse } from "@/lib/api/usage";

describe("sampling impact", () => {
  it("uses estimated source volume by event class", () => {
    const usage: UsageResponse = {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-03T00:00:00.000Z",
      intervalSeconds: 3600,
      totals: { accepted: 300, estimated: 1000, sampled: 0, rejected: 0, failed: 0, bytes: 30000 },
      breakdown: [
        {
          bucket: "2026-09-02T00:00:00.000Z",
          eventType: "page_view",
          outcome: "accepted",
          reason: "",
          events: 100,
          estimated: 500,
          bytes: 10000,
        },
        {
          bucket: "2026-09-02T00:00:00.000Z",
          eventType: "api",
          outcome: "accepted",
          reason: "",
          events: 100,
          estimated: 400,
          bytes: 10000,
        },
        {
          bucket: "2026-09-02T00:00:00.000Z",
          eventType: "error",
          outcome: "accepted",
          reason: "",
          events: 100,
          estimated: 100,
          bytes: 10000,
        },
      ],
    };
    const result = calculateSamplingImpact(usage, 0.2, 0.25, 1);
    expect(result.currentDaily).toBe(150);
    expect(result.projectedDaily).toBe(150);
    expect(result.deltaPercent).toBe(0);

    // Errors used to be pinned at 100% here because the server always reported
    // errorSampleRate as 1; lowering it has to move the projection.
    const halvedErrors = calculateSamplingImpact(usage, 0.2, 0.25, 0.5);
    expect(halvedErrors.projectedDaily).toBe(125);
  });
});
