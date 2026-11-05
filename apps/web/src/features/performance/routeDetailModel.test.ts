import { describe, expect, it } from "vitest";
import {
  alignPrevious,
  bucketRating,
  denseDistribution,
  latestReleases,
  previousRange,
  quantileMarks,
  ratingShares,
  releaseMarkers,
  trendGrid,
} from "./routeDetailModel";

describe("previousRange", () => {
  it("returns the window of the same length ending at the current start", () => {
    const range = previousRange(new Date("2026-11-08T00:00:00Z"), new Date("2026-11-15T00:00:00Z"));
    expect(range.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe("ratingShares", () => {
  const bucket = (from: number, samples: number, width = 250, overflow = false) => ({
    from,
    to: from + width,
    samples,
    overflow,
  });

  it("sums whole buckets when thresholds sit on bucket edges", () => {
    // LCP: good ≤ 2500, poor > 4000; 250ms buckets align with both.
    const shares = ratingShares(
      [
        bucket(2000, 30),
        bucket(2250, 10),
        bucket(3000, 40),
        bucket(4500, 15),
        bucket(5000, 5, 250, true),
      ],
      "LCP",
    )!;
    expect(shares.total).toBe(100);
    expect(shares.good).toBeCloseTo(0.4);
    expect(shares.needsImprovement).toBeCloseTo(0.4);
    expect(shares.poor).toBeCloseTo(0.2);
    expect(shares.approximate).toBe(false);
  });

  it("splits a bucket that a threshold falls inside and marks it approximate", () => {
    // FCP good ≤ 1800 lands inside [1750, 2000): a fifth of it counts as good.
    const shares = ratingShares([bucket(1500, 50), bucket(1750, 50)], "FCP")!;
    expect(shares.good).toBeCloseTo(0.6);
    expect(shares.needsImprovement).toBeCloseTo(0.4);
    expect(shares.approximate).toBe(true);
  });

  it("gives no shares without samples", () => {
    expect(ratingShares([], "LCP")).toBeNull();
    expect(ratingShares([bucket(0, 0)], "LCP")).toBeNull();
  });

  it("rates a bucket by its midpoint and the overflow bucket as its lower edge", () => {
    expect(bucketRating(bucket(2250, 1), "LCP")).toBe("good");
    expect(bucketRating(bucket(3750, 1), "LCP")).toBe("needs-improvement");
    expect(bucketRating(bucket(5000, 1, 250, true), "LCP")).toBe("poor");
  });
});

describe("alignPrevious", () => {
  const point = (bucket: string, value: number) => ({ bucket, value });
  const day = 86400000;

  it("shifts previous buckets forward by the window length", () => {
    const aligned = alignPrevious(
      [point("2026-11-08T00:00:00Z", 1), point("2026-11-08T06:00:00Z", 2)],
      [point("2026-11-01T06:00:00Z", 9)],
      7 * day,
    );
    expect(aligned.map((item) => item.previous?.value)).toEqual([undefined, 9]);
  });

  it("lands an off-grid previous bucket on the nearest current bucket", () => {
    // A 7.5-hour window shifts 6-hour buckets by a non-multiple.
    const aligned = alignPrevious(
      [point("2026-11-08T00:00:00Z", 1), point("2026-11-08T06:00:00Z", 2)],
      [point("2026-11-07T22:00:00Z", 9)],
      7.5 * 3600000,
    );
    expect(aligned.map((item) => item.previous?.value)).toEqual([undefined, 9]);
  });

  it("keeps the current series when the previous window is missing", () => {
    expect(alignPrevious([point("2026-11-08T00:00:00Z", 1)], undefined, day)).toEqual([
      { current: point("2026-11-08T00:00:00Z", 1), previous: undefined },
    ]);
  });
});

describe("histogram helpers", () => {
  it("fills empty buckets so bars keep their value position", () => {
    const dense = denseDistribution([
      { from: 250, to: 500, samples: 3 },
      { from: 1000, to: 1250, samples: 1 },
      { from: 5000, to: 5250, samples: 2, overflow: true },
    ]);
    expect(dense.map((bucket) => bucket.from)).toEqual([
      0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750,
      4000, 4250, 4500, 4750, 5000,
    ]);
    expect(dense[2].samples).toBe(0);
    expect(dense.at(-1)?.overflow).toBe(true);
  });

  it("puts each quantile on its bucket and merges quantiles that share one", () => {
    const buckets = [
      { from: 0, to: 250, samples: 1 },
      { from: 250, to: 500, samples: 1 },
      { from: 500, to: 750, samples: 1, overflow: true },
    ];
    expect(
      quantileMarks(buckets, [
        { label: "P50", value: 300 },
        { label: "P75", value: 400 },
        { label: "P95", value: 9000 },
        { label: "P99", value: null },
      ]),
    ).toEqual([
      { from: 250, label: "P50/P75" },
      { from: 500, label: "P95" },
    ]);
  });
});

describe("release helpers", () => {
  const metric = (p75: number | null) => ({ p75, samples: 10, sufficient: false });
  const grid = ["2026-11-08T00:00:00Z", "2026-11-08T06:00:00Z", "2026-11-08T12:00:00Z"].map(
    (bucket) => ({ bucket }),
  );
  const releases = [
    // Already live: first seen where the route's data begins.
    { value: "old", metric: metric(3000), firstSeen: "2026-11-08T01:00:00Z" },
    { value: "older", metric: metric(2900), firstSeen: "2026-11-08T00:30:00Z" },
    { value: "mid", metric: metric(3500), firstSeen: "2026-11-08T07:30:00Z" },
    { value: "new", metric: metric(4500), firstSeen: "2026-11-08T13:00:00Z" },
    { value: "empty", metric: metric(null), firstSeen: "2026-11-08T14:00:00Z" },
  ];

  it("marks only releases that appeared after the first bucket, merging a shared bucket", () => {
    expect(releaseMarkers(grid, releases)).toEqual([
      { bucket: "2026-11-08T12:00:00Z", release: "empty / new" },
      { bucket: "2026-11-08T06:00:00Z", release: "mid" },
    ]);
    expect(releaseMarkers(grid, releases.slice(0, 2))).toEqual([]);
  });

  it("compares the newest appeared release with the one before it", () => {
    expect(latestReleases(grid, releases, "p75")?.map((release) => release.value)).toEqual([
      "new",
      "mid",
    ]);
    // Both already live: their order is unknown, so no comparison.
    expect(latestReleases(grid, releases.slice(0, 2), "p75")).toBeNull();
  });
});

describe("trendGrid", () => {
  const metric = { p75: 1, samples: 1, sufficient: false };
  it("keeps empty buckets across the window", () => {
    const grid = trendGrid([{ bucket: "2026-11-08T12:00:00Z", metric }], {
      from: "2026-11-08T00:00:00Z",
      to: "2026-11-09T00:00:00Z",
      intervalSeconds: 21600,
    });
    expect(grid.map((point) => [point.bucket.slice(11, 16), Boolean(point.metric)])).toEqual([
      ["00:00", false],
      ["06:00", false],
      ["12:00", true],
      ["18:00", false],
    ]);
  });

  it("falls back to the returned buckets without an interval", () => {
    expect(trendGrid([{ bucket: "2026-11-08T12:00:00Z", metric }], undefined)).toHaveLength(1);
  });
});
