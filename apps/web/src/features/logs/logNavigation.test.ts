import { describe, expect, it } from "vitest";
import { logBucketRange, logDetailLink } from "./logNavigation";
import type { LogEntry } from "@/lib/api/logs";

describe("log investigation navigation", () => {
  it("pins a share link to a log without retaining a moving range or page cursor", () => {
    const entry = { eventId: "id", timestamp: "2026-11-11T13:00:00.123Z" } as LogEntry;
    const url = new URL(
      logDetailLink(
        "http://localhost/projects/p/logs?from=a&to=b&timePreset=24h&cursor=old&q=level:error",
        entry,
      ),
    );
    expect(url.searchParams.get("log")).toBe("id");
    expect(url.searchParams.get("logAt")).toBe(entry.timestamp);
    expect(url.searchParams.get("q")).toBe("level:error");
    expect(url.searchParams.has("timePreset")).toBe(false);
    expect(url.searchParams.has("cursor")).toBe(false);
  });
  it("clips partial buckets to the selected range and rejects empty selections", () => {
    expect(
      logBucketRange("2026-11-11T10:00:00Z", 3600, "2026-11-11T10:20:00Z", "2026-11-11T10:50:00Z"),
    ).toEqual({ from: "2026-11-11T10:20:00.000Z", to: "2026-11-11T10:50:00.000Z" });
    expect(
      logBucketRange("2026-11-12T10:00:00Z", 3600, "2026-11-11T10:20:00Z", "2026-11-11T10:50:00Z"),
    ).toBeNull();
  });
});
