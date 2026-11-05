import type { PerformanceMetricName, PerformanceResponse } from "@/lib/api/performance";
import { performanceRating, performanceThresholds } from "./score";

type Detail = NonNullable<PerformanceResponse["detail"]>;

/** The window of the same length that ends where the current one starts. */
export function previousRange(from: Date, to: Date) {
  const duration = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - duration), to: new Date(from.getTime()) };
}

export type RatingShares = {
  good: number;
  needsImprovement: number;
  poor: number;
  total: number;
  /** A threshold falls inside a histogram bucket, so that bucket is split linearly. */
  approximate: boolean;
};

/**
 * Good / needs-improvement / poor shares of raw samples, read from the detail histogram.
 * Buckets are `[from, to)`; the overflow bucket holds everything above the last edge.
 */
export function ratingShares(
  distribution: Detail["distribution"],
  metric: PerformanceMetricName,
): RatingShares | null {
  const total = distribution.reduce((sum, bucket) => sum + bucket.samples, 0);
  if (!total) return null;
  const { good, poor } = performanceThresholds[metric];
  let approximate = false;
  const below = (threshold: number) =>
    distribution.reduce((sum, bucket) => {
      if (bucket.overflow) return threshold >= bucket.from ? Number.NaN : sum;
      if (threshold >= bucket.to) return sum + bucket.samples;
      if (threshold <= bucket.from) return sum;
      if (bucket.samples) approximate = true;
      return sum + (bucket.samples * (threshold - bucket.from)) / (bucket.to - bucket.from);
    }, 0);
  const goodCount = below(good);
  const notPoorCount = below(poor);
  // A threshold above the overflow edge cannot be split; give no shares rather than guess.
  if (!Number.isFinite(goodCount) || !Number.isFinite(notPoorCount)) return null;
  return {
    good: goodCount / total,
    needsImprovement: (notPoorCount - goodCount) / total,
    poor: (total - notPoorCount) / total,
    total,
    approximate,
  };
}

/** Rating of a histogram bucket by its midpoint; the overflow bucket by its lower edge. */
export function bucketRating(
  bucket: Detail["distribution"][number],
  metric: PerformanceMetricName,
) {
  return performanceRating(bucket.overflow ? bucket.from : (bucket.from + bucket.to) / 2, metric);
}

/**
 * Places the previous window's buckets on the current grid by shifting each one forward by
 * the window length. A window that is not a whole number of buckets leaves the shifted
 * buckets off-grid, so each lands on the current bucket within half a bucket of it.
 * Current buckets without a match keep an undefined previous point.
 */
export function alignPrevious<T extends { bucket: string }>(
  current: readonly T[],
  previous: readonly T[] | undefined,
  durationMs: number,
): { current: T; previous: T | undefined }[] {
  const times = current.map((point) => Date.parse(point.bucket));
  const step = times.length > 1 ? times[1] - times[0] : Number.POSITIVE_INFINITY;
  const matched = new Map<number, T>();
  for (const point of previous ?? []) {
    const shifted = Date.parse(point.bucket) + durationMs;
    let best = -1;
    for (let index = 0; index < times.length; index += 1)
      if (best < 0 || Math.abs(times[index] - shifted) < Math.abs(times[best] - shifted))
        best = index;
    if (best >= 0 && Math.abs(times[best] - shifted) < step / 2 && !matched.has(best))
      matched.set(best, point);
  }
  return current.map((point, index) => ({ current: point, previous: matched.get(index) }));
}

/**
 * The API returns only non-empty histogram buckets. Fill the gaps with zero so the bars keep
 * their true position on the value axis; the overflow bucket stays last.
 */
export function denseDistribution(distribution: Detail["distribution"]): Detail["distribution"] {
  const regular = distribution.filter((bucket) => !bucket.overflow);
  const overflow = distribution.find((bucket) => bucket.overflow);
  const sample = regular[0] ?? overflow;
  if (!sample) return [];
  const width = sample.to - sample.from;
  const last = overflow
    ? Math.round(overflow.from / width) - 1
    : Math.round(regular[regular.length - 1].from / width);
  const byIndex = new Map(regular.map((bucket) => [Math.round(bucket.from / width), bucket]));
  const filled = Array.from(
    { length: last + 1 },
    (_, index) =>
      byIndex.get(index) ?? { from: index * width, to: (index + 1) * width, samples: 0 },
  );
  return overflow ? [...filled, overflow] : filled;
}

/** P50/P75/P95 placed on the histogram bucket that holds each value; shared buckets merge. */
export function quantileMarks(
  distribution: Detail["distribution"],
  values: { label: string; value: number | null | undefined }[],
) {
  const marks = new Map<number, string[]>();
  for (const { label, value } of values) {
    if (value == null || !Number.isFinite(value)) continue;
    const bucket =
      distribution.find((item) => !item.overflow && value >= item.from && value < item.to) ??
      distribution.find((item) => item.overflow && value >= item.from);
    if (!bucket) continue;
    marks.set(bucket.from, [...(marks.get(bucket.from) ?? []), label]);
  }
  return [...marks].map(([from, labels]) => ({ from, label: labels.join("/") }));
}

type Release = Detail["releases"][number];

/**
 * `firstSeen` is the earliest sample inside the window, so a release that was already live
 * looks "first seen" wherever the route's data begins. Only a release first seen in a later
 * bucket than the earliest one is known to have appeared inside the window.
 */
function appearedInWindow(buckets: readonly { bucket: string }[], releases: readonly Release[]) {
  const times = buckets.map((point) => Date.parse(point.bucket));
  const indexOf = (at: number) => {
    let index = 0;
    while (index + 1 < times.length && times[index + 1] <= at) index += 1;
    return index;
  };
  const seen = releases.filter((release) => release.firstSeen);
  if (!times.length || !seen.length) return [];
  const baseline = Math.min(...seen.map((release) => indexOf(Date.parse(release.firstSeen!))));
  return seen
    .map((release) => ({ release, index: indexOf(Date.parse(release.firstSeen!)) }))
    .filter((item) => item.index > baseline)
    .sort((a, b) => Date.parse(b.release.firstSeen!) - Date.parse(a.release.firstSeen!));
}

/** Releases that appeared inside the window, on their bucket; a shared bucket merges. */
export function releaseMarkers(
  buckets: readonly { bucket: string }[],
  releases: readonly Release[],
  limit = 4,
) {
  return appearedInWindow(buckets, releases)
    .slice(0, limit)
    .reduce<{ bucket: string; release: string }[]>((marks, { release, index }) => {
      const bucket = buckets[index].bucket;
      const same = marks.find((item) => item.bucket === bucket);
      if (same) same.release = `${same.release} / ${release.value}`;
      else marks.push({ bucket, release: release.value });
      return marks;
    }, []);
}

/**
 * The newest release that appeared inside the window and the release just before it, both
 * with a value. Null when no release is known to be new, since the order is then unknown.
 */
export function latestReleases(
  buckets: readonly { bucket: string }[],
  releases: readonly Release[],
  percentile: "p50" | "p75" | "p95",
): [Release, Release] | null {
  const withValue = releases.filter(
    (release) => release.firstSeen && release.metric[percentile] != null,
  );
  const newest = appearedInWindow(buckets, withValue)[0]?.release;
  if (!newest) return null;
  const before = withValue
    .filter((release) => Date.parse(release.firstSeen!) < Date.parse(newest.firstSeen!))
    .sort((a, b) => Date.parse(b.firstSeen!) - Date.parse(a.firstSeen!))[0];
  return before ? [newest, before] : null;
}

/**
 * The route trend returns only buckets with samples. Lay them on the full window grid so
 * gaps stay visible as gaps (docs/agents/time-series.md); missing buckets carry no metric.
 */
export function trendGrid(
  trend: Detail["trend"],
  range: { from?: string; to?: string; intervalSeconds?: number } | undefined,
): { bucket: string; metric?: Detail["trend"][number]["metric"] }[] {
  const step = (range?.intervalSeconds ?? 0) * 1000;
  const start = Math.floor(Date.parse(range?.from ?? "") / step) * step;
  const end = Date.parse(range?.to ?? "");
  if (!step || !Number.isFinite(start) || !Number.isFinite(end) || (end - start) / step > 1000)
    return trend.map((point) => ({ bucket: point.bucket, metric: point.metric }));
  const byTime = new Map(trend.map((point) => [Date.parse(point.bucket), point.metric]));
  const grid: { bucket: string; metric?: Detail["trend"][number]["metric"] }[] = [];
  for (let at = start; at < end; at += step)
    grid.push({ bucket: new Date(at).toISOString(), metric: byTime.get(at) });
  return grid;
}
