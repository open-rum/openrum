import { describe, expect, it } from "vitest";
import { formatIssueTrendTime, formatIssueTrendTooltip } from "./trendTime";

describe("issue trend timestamps", () => {
  it("formats the point timestamp even when the shared tooltip supplies a series label", () => {
    const timestamp = Date.parse("2026-09-12T13:52:00Z");
    const expected = new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
    expect(formatIssueTrendTooltip("错误事件", [{ payload: { timestamp } }])).toBe(expected);
    expect(formatIssueTrendTooltip("影响用户", [{ payload: { timestamp } }])).toBe(expected);
    expect(formatIssueTrendTime(timestamp)).toBe(expected);
  });

  it.each([undefined, null, "错误事件", "", NaN, Infinity, -Infinity, 1e20])(
    "handles an invalid or transient timestamp %s without throwing",
    (timestamp) => {
      expect(formatIssueTrendTime(timestamp)).toBe("时间不可用");
      expect(formatIssueTrendTooltip("错误事件", [{ payload: { timestamp } }])).toBe("时间不可用");
    },
  );

  it("handles an empty tooltip during pointer leave or data replacement", () => {
    expect(formatIssueTrendTooltip(undefined)).toBe("时间不可用");
    expect(formatIssueTrendTooltip(undefined, [])).toBe("时间不可用");
    expect(formatIssueTrendTooltip(undefined, [{}])).toBe("时间不可用");
  });
});
