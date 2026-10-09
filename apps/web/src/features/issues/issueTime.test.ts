import { describe, expect, it } from "vitest";
import { formatRelativeTime, isNewInRange } from "./issueTime";

const now = new Date("2026-10-02T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("uses minutes, hours and days before falling back to a date", () => {
    expect(formatRelativeTime("2026-10-02T11:59:30Z", now)).toBe("刚刚");
    expect(formatRelativeTime("2026-10-02T11:45:00Z", now)).toBe("15分钟前");
    expect(formatRelativeTime("2026-10-02T09:00:00Z", now)).toBe("3小时前");
    expect(formatRelativeTime("2026-10-01T09:00:00Z", now)).toBe("昨天");
    expect(formatRelativeTime("2026-09-20T09:00:00Z", now)).toMatch(/09\/20/);
  });
});

describe("isNewInRange", () => {
  it("treats a first sighting inside the range as new", () => {
    const from = new Date("2026-10-01T12:00:00Z");
    expect(isNewInRange("2026-10-01T13:00:00Z", from)).toBe(true);
    expect(isNewInRange("2026-09-28T13:00:00Z", from)).toBe(false);
  });
});
