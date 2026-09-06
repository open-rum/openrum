import { describe, expect, it } from "vitest";
import {
  behaviorAnalyticsSchema,
  defaultBehaviorFilters,
  funnelResultSchema,
  pathResultSchema,
  retentionResultSchema,
  serializeBehaviorFilters,
} from "./analytics";

describe("behavior analytics API", () => {
  it("round-trips shareable behavior filters", () => {
    const source = new URLSearchParams({
      from: "2026-09-02T00:00:00.000Z",
      to: "2026-09-03T00:00:00.000Z",
      environment: "production",
      eventKind: "custom",
      eventName: "checkout_completed",
      dimension: "property:channel",
    });
    const filters = defaultBehaviorFilters("018f4d9c-83a1-76c9-81c2-3020ab660000", source);
    expect(filters.dimension).toBe("property:channel");
    expect(serializeBehaviorFilters(filters).get("eventName")).toBe("checkout_completed");
  });

  it("rejects unsafe property dimensions and invalid API contracts", () => {
    const filters = defaultBehaviorFilters(
      "018f4d9c-83a1-76c9-81c2-3020ab660000",
      new URLSearchParams({ dimension: "property:bad key" }),
      new Date("2026-09-03T00:00:00.000Z"),
    );
    expect(filters.dimension).toBe("country");
    expect(
      behaviorAnalyticsSchema.safeParse({
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-03T00:00:00.000Z",
        totals: { events: -1 },
      }).success,
    ).toBe(false);
  });

  it("accepts the bounded funnel response contract", () => {
    expect(
      funnelResultSchema.safeParse({
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-03T00:00:00.000Z",
        dimension: "country",
        windowSeconds: 3600,
        identity: "session_id",
        approximate: true,
        steps: [
          {
            index: 1,
            kind: "page_view",
            name: "page_view",
            sessions: 10,
            conversionFromPrevious: null,
            conversionFromFirst: null,
          },
        ],
        breakdown: [{ value: "CN", stepCounts: [10] }],
        samples: [
          {
            sessionId: "018f4d9c-83a1-76c9-81c2-3020ab660000",
            reachedStep: 1,
            lastSeenAt: "2026-09-02T01:00:00.000Z",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("bounds path depth and weekly retention contracts", () => {
    expect(
      pathResultSchema.safeParse({
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-03T00:00:00.000Z",
        depth: 5,
        topN: 20,
        identity: "session_id",
        approximate: true,
        totalSessions: 10,
        paths: [{ events: ["page:/", "click"], sessions: 4, share: 0.4 }],
      }).success,
    ).toBe(true);
    expect(
      retentionResultSchema.safeParse({
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
        weeks: 8,
        identity: "anonymous_user_id",
        approximate: true,
        definition: "first activity in range",
        cohorts: [
          {
            cohortWeek: "2026-07-06T00:00:00.000Z",
            users: 10,
            retention: [{ weekIndex: 0, users: 10, rate: 1 }],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
