import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeLogTrend,
  getLog,
  getLogs,
  logPageSchema,
  logSearchTerm,
  type LogPage,
} from "./logs";

afterEach(() => vi.unstubAllGlobals());

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
  it("keeps unknown gaps distinct from explicit zero-count buckets", () => {
    const trend = completeLogTrend(data, "2026-09-12T10:00:00Z", "2026-09-12T10:03:00Z");
    expect(trend.map((point) => point.info)).toEqual([null, 2, null]);
    const zero = completeLogTrend(
      { ...data, trend: [{ ...data.trend[0], info: 0 }] },
      "2026-09-12T10:00:00Z",
      "2026-09-12T10:03:00Z",
    );
    expect(zero.map((point) => point.info)).toEqual([null, 0, null]);
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

  it("restores a linked log without depending on subsecond database parameter precision", async () => {
    const eventId = "13af3016-0096-4e8f-a51b-5a0a6facd321";
    const timestamp = "2026-11-11T13:21:31.184Z";
    const entry = {
      eventId,
      timestamp,
      level: "error",
      message: "upstream timeout",
      logger: "payment",
      environment: "production",
      release: "1.0.0",
      route: "/checkout",
      pageUrl: "https://example.com/checkout",
      browser: "Chrome",
      deviceType: "desktop",
      country: "CN",
      sessionId: "a25753a5-0714-4555-9c99-cd8c20a90722",
      userId: "customer-123",
      anonymousUserId: "visitor-abc",
      traceId: "",
      spanId: "",
      attributes: { "error.code": "UPSTREAM_TIMEOUT" },
      sampleRate: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...data, items: [entry] })));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(getLog("project-id", eventId, timestamp, signal)).resolves.toEqual(entry);

    const [path, options] = fetchMock.mock.calls[0];
    const url = new URL(path, "https://console.example.com");
    expect(url.pathname).toBe("/api/v1/projects/project-id/logs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-11-11T13:20:31.184Z",
      to: "2026-11-11T13:22:31.184Z",
      q: `event_id:"${eventId}"`,
      maxPoints: "30",
    });
    expect(options.signal).toBe(signal);
  });

  it("returns no entry when a valid link points to a log that is no longer available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    await expect(
      getLog("project-id", "13af3016-0096-4e8f-a51b-5a0a6facd321", "2026-11-11T13:21:31.184Z"),
    ).resolves.toBeNull();
  });

  it.each([
    ["invalid", "2026-11-11T13:21:31.184Z"],
    ["13af3016-0096-4e8f-a51b-5a0a6facd321", "invalid"],
  ])("rejects invalid log links before sending a request", async (eventId, timestamp) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getLog("project-id", eventId, timestamp)).rejects.toThrow("日志链接无效");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends the original anchor and direction alongside the global range on context pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...data, previousCursor: "earlier" })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getLogs({
      projectId: "project",
      from: "2026-11-11T00:00:00Z",
      to: "2026-11-12T00:00:00Z",
      q: "logger:payment",
      anchor: "13af3016-0096-4e8f-a51b-5a0a6facd321",
      anchorAt: "2026-11-11T13:21:31.184Z",
      cursor: "cursor",
      direction: "before",
    });
    const url = new URL(fetchMock.mock.calls[0][0], "https://example.com");
    expect(url.searchParams.get("anchorAt")).toBe("2026-11-11T13:21:31.184Z");
    expect(url.searchParams.get("direction")).toBe("before");
    expect(url.searchParams.get("cursor")).toBe("cursor");
    expect(result.previousCursor).toBe("earlier");
  });
});
