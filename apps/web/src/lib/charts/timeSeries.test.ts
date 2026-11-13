import { describe, expect, it } from "vitest";
import { chartTicks, intervalSeconds, partialBucketEdges, timeTickLabel } from "./timeSeries";

const minute = 60_000;
const at = (value: string) => Date.parse(value);

describe("partialBucketEdges", () => {
  const five = intervalSeconds("5 MINUTE");
  const buckets = [
    at("2026-10-11T10:00:00Z"),
    at("2026-10-11T10:05:00Z"),
    at("2026-10-11T10:10:00Z"),
  ];

  it("marks the bucket still running at the right edge", () => {
    const edges = partialBucketEdges(
      buckets,
      five,
      at("2026-10-11T10:00:00Z"),
      at("2026-10-11T10:12:00Z"),
    );
    expect(edges).toEqual({ first: false, last: true });
  });

  it("marks a first bucket that begins before the range does", () => {
    const edges = partialBucketEdges(
      buckets,
      five,
      at("2026-10-11T10:03:00Z"),
      at("2026-10-11T10:15:00Z"),
    );
    expect(edges).toEqual({ first: true, last: false });
  });

  it("marks nothing for an aligned range", () => {
    const edges = partialBucketEdges(
      buckets,
      five,
      at("2026-10-11T10:00:00Z"),
      at("2026-10-11T10:15:00Z"),
    );
    expect(edges).toEqual({ first: false, last: false });
  });

  it("does not guess when the interval is unknown or there is nothing to compare", () => {
    expect(partialBucketEdges(buckets, 0, 0, Date.now() + minute)).toEqual({
      first: false,
      last: false,
    });
    expect(partialBucketEdges([buckets[0]], five, 0, buckets[0] + minute)).toEqual({
      first: false,
      last: false,
    });
    expect(partialBucketEdges(buckets, five, Number.NaN, Number.NaN)).toEqual({
      first: false,
      last: false,
    });
  });
});

describe("chartTicks", () => {
  const rowsEvery = (hours: number, length: number) =>
    Array.from({ length }, (_, index) => ({
      label: new Date(Date.UTC(2026, 10, 3, 18) + index * hours * 3_600_000).toISOString(),
    }));

  it("names whole days at even day steps over a multi-day range", () => {
    const ticks = chartTicks(rowsEvery(6, 30), 800);
    const days = ticks.map((label) => new Date(label).getDate());
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
    const steps = days.slice(1).map((day, index) => day - days[index]);
    expect(new Set(steps).size).toBe(1);
    // Each label is the first bucket of its local day.
    for (const label of ticks) {
      const time = Date.parse(label);
      expect(new Date(time - 6 * 3_600_000).toDateString()).not.toBe(new Date(time).toDateString());
    }
  });

  it("spreads labels evenly over a short range", () => {
    const rows = rowsEvery(1, 24);
    expect(chartTicks(rows, 800)[0]).toBe(rows[0].label);
  });
});

describe("timeTickLabel", () => {
  const hour = 3_600_000;
  const label = "2026-11-10T13:00:00Z";
  const clock = new Date(label).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = new Date(label).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });

  it("names the time of day alone within a day", () => {
    expect(timeTickLabel(label, 6 * hour)).toBe(clock);
  });

  it("adds the date once the range reaches a day, where one clock time falls on two dates", () => {
    expect(timeTickLabel(label, 24 * hour)).toBe(`${day} ${clock}`);
    expect(timeTickLabel(label, 48 * hour)).toBe(`${day} ${clock}`);
  });

  it("names the date alone over more than two days", () => {
    expect(timeTickLabel(label, 7 * 24 * hour)).toBe(day);
  });
});
