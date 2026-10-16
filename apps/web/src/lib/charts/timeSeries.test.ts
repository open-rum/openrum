import { describe, expect, it } from "vitest";
import { intervalSeconds, partialBucketEdges } from "./timeSeries";

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
