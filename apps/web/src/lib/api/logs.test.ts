import { describe, expect, it } from "vitest";
import { completeLogTrend, logPageSchema, logSearchTerm, type LogPage } from "./logs";

describe("logs", () => {
  const data: LogPage = {
    items: [],
    trend: [
      { bucket: "2026-09-12T10:01:00Z", trace: 0, debug: 0, info: 2, warn: 0, error: 1, fatal: 0 },
    ],
    total: 3,
    nextCursor: "",
    intervalSeconds: 60,
  };
  it("keeps zero-count gaps and the requested time bounds", () => {
    const trend = completeLogTrend(data, "2026-09-12T10:00:00Z", "2026-09-12T10:03:00Z");
    expect(trend.map((point) => point.info)).toEqual([0, 2, 0]);
    expect(completeLogTrend(data, "bad", "also bad")).toEqual([]);
  });
  it("validates timestamps before rendering and quotes filter values", () => {
    expect(logPageSchema.safeParse(data).success).toBe(true);
    expect(
      logPageSchema.safeParse({ ...data, trend: [{ ...data.trend[0], bucket: "invalid" }] })
        .success,
    ).toBe(false);
    expect(logSearchTerm("order.id", 'a "quoted" value')).toBe(
      'order.id:"a \\"quoted\\" value"'.replaceAll("\\\\", "\\"),
    );
  });
  it("preserves captured user fields and tolerates responses from older APIs", () => {
    const userFields = logPageSchema.shape.items.element.pick({
      userId: true,
      anonymousUserId: true,
    });
    expect(userFields.parse({ userId: "customer-123", anonymousUserId: "visitor-abc" })).toEqual({
      userId: "customer-123",
      anonymousUserId: "visitor-abc",
    });
    expect(userFields.parse({})).toEqual({ userId: "", anonymousUserId: "" });
    expect(logSearchTerm("user.id", 'customer "quoted"')).toBe('user.id:"customer \\"quoted\\""');
  });
});
