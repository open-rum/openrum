import { describe, expect, it } from "vitest";
import { buildHeatmap, levelFor, weekday } from "./heatmapLayout";

const day = 86400;
// 2026-09-01 is a Tuesday; 30 days end partway through 2026-09-30.
const range = { from: "2026-09-01T00:00:00Z", to: "2026-09-30T08:00:00Z", intervalSeconds: day };

describe("buildHeatmap", () => {
  it("lays out one cell per UTC day in Monday-first week columns", () => {
    const heatmap = buildHeatmap(range, []);
    expect(heatmap).not.toBeNull();
    expect(heatmap!.cells).toHaveLength(30);
    expect(heatmap!.weeks.every((week) => week.length === 7)).toBe(true);
    // Monday 2026-08-31 is outside the range, so the first slot is empty.
    expect(heatmap!.weeks[0]?.[0]).toBeNull();
    expect(weekday(heatmap!.weeks[0]![1]!.date)).toBe(1);
    expect(heatmap!.cells.at(-1)?.partial).toBe(true);
    expect(heatmap!.cells[0]?.partial).toBe(false);
    expect(heatmap!.monthLabels.get(0)).toBe("9月");
  });

  it("keeps missing days null and real zeroes at level 0", () => {
    const heatmap = buildHeatmap(range, [
      { bucket: "2026-09-02T00:00:00Z", value: 0 },
      { bucket: "2026-09-03T00:00:00Z", value: 100 },
      { bucket: "2026-09-04T00:00:00Z", value: 30 },
    ])!;
    expect(heatmap.cells[0]).toMatchObject({ value: null, level: null });
    expect(heatmap.cells[1]).toMatchObject({ value: 0, level: 0 });
    expect(heatmap.cells[2]).toMatchObject({ value: 100, level: 4 });
    expect(heatmap.cells[3]).toMatchObject({ value: 30, level: 2 });
    expect(heatmap.total).toBe(130);
    expect(heatmap.activeDays).toBe(2);
    expect(heatmap.peak?.date.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(heatmap.hasData).toBe(true);
  });

  it("reports an empty calendar when nothing was returned", () => {
    const heatmap = buildHeatmap(range, [])!;
    expect(heatmap.hasData).toBe(false);
    expect(heatmap.peak).toBeNull();
    expect(heatmap.cells.every((cell) => cell.level === null)).toBe(true);
  });

  it("refuses non-daily buckets instead of re-aggregating them", () => {
    expect(buildHeatmap({ ...range, intervalSeconds: 3600 }, [])).toBeNull();
  });
});

describe("levelFor", () => {
  it("steps by quarters of the project's own peak", () => {
    expect(levelFor(null, 100)).toBeNull();
    expect(levelFor(0, 100)).toBe(0);
    expect(levelFor(25, 100)).toBe(1);
    expect(levelFor(26, 100)).toBe(2);
    expect(levelFor(75, 100)).toBe(3);
    expect(levelFor(76, 100)).toBe(4);
  });
});
