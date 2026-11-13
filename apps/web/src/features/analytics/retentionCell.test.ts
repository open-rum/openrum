import { describe, expect, it } from "vitest";
import { retentionCell } from "./retentionCell";

const range = { from: "2026-10-05T00:00:00Z", to: "2026-11-02T00:00:00Z" };
const cohort = {
  cohortWeek: range.from,
  users: 10,
  retention: [{ weekIndex: 0, users: 10, rate: 1 }],
};
const now = Date.parse("2026-11-05T00:00:00Z");
describe("weekly observation states", () => {
  it("distinguishes zero return from an unqueried or future week", () => {
    expect(retentionCell(range, cohort, 1, now).label).toBe("0%");
    expect(retentionCell(range, cohort, 4, now).label).toBe("范围外");
    expect(retentionCell(range, cohort, 5, now).label).toBe("待观察");
  });
  it("does not turn an unfinished week without returns into a final zero", () => {
    const partial = { ...range, to: "2026-10-14T00:00:00Z" };
    expect(retentionCell(partial, cohort, 1, now).label).toBe("观察中");
    const withReturn = {
      ...cohort,
      retention: [...cohort.retention, { weekIndex: 1, users: 2, rate: 0.2 }],
    };
    expect(retentionCell(partial, withReturn, 1, now).label).toBe("20% · 部分周");
  });
  it("marks a starting week truncated by the selected range as partial", () => {
    expect(retentionCell({ ...range, from: "2026-10-07T00:00:00Z" }, cohort, 0, now).label).toBe(
      "100% · 部分周",
    );
  });
});
