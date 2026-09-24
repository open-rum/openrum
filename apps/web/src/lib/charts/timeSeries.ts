/** Console-wide policy. Read docs/agents/time-series.md before changing it. */
export const TIME_SERIES_MAX_POINTS = 30;

export function intervalSeconds(interval: string) {
  const match = /^(\d+) (MINUTE|HOUR|DAY)$/.exec(interval);
  return match ? Number(match[1]) * ({ MINUTE: 60, HOUR: 3600, DAY: 86400 }[match[2]] ?? 0) : 0;
}

export function intervalLabel(seconds: number) {
  if (seconds >= 86400) return `${seconds / 86400} 天`;
  if (seconds >= 3600) return `${seconds / 3600} 小时`;
  return `${seconds / 60} 分钟`;
}

export type TimeSeriesRow = Record<string, string | number | null>;
export type TimeSeriesRange = { from?: string; to?: string; intervalSeconds?: number };

// Fill absent buckets with nulls, never zeroes; do not average P75/rates or sum UV.
export function continuousRows(
  rows: TimeSeriesRow[],
  from: string,
  to: string,
  seconds: number,
  keys: string[],
): TimeSeriesRow[] {
  if (!seconds || !rows.length) return rows;
  const step = seconds * 1000;
  const start = Math.floor(Date.parse(from) / step) * step;
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) / step > 1000) return rows;
  const byTime = new Map(rows.map((row) => [Date.parse(String(row.label)), row]));
  const result: TimeSeriesRow[] = [];
  for (let at = start; at < end; at += step) {
    result.push(
      byTime.get(at) ?? {
        label: new Date(at).toISOString(),
        ...Object.fromEntries(keys.map((key) => [key, null])),
      },
    );
  }
  return result;
}

/** Adapt API buckets without guessing intervals for older servers. */
export function bucketRows(
  points: Array<{ bucket: string } & Record<string, string | number>>,
  range: TimeSeriesRange,
) {
  const rows = points.map((point) => ({ ...point, label: point.bucket }));
  const keys = points.length ? Object.keys(points[0]).filter((key) => key !== "bucket") : [];
  const padded =
    range.from && range.to && range.intervalSeconds
      ? continuousRows(rows, range.from, range.to, range.intervalSeconds, keys)
      : rows;
  return padded.map((row) => ({ ...row, timestamp: Date.parse(String(row.label)) }));
}

// Keep actual bucket positions (including gaps) and a small, width-based label budget.
export function chartTicks(rows: TimeSeriesRow[], width: number): string[] {
  const count = Math.max(2, Math.min(6, Math.floor((width - 72) / 110)));
  if (rows.length <= count) return rows.map((row) => String(row.label));
  return Array.from({ length: count }, (_, index) =>
    String(rows[Math.round((index * (rows.length - 1)) / (count - 1))].label),
  );
}

export function timeTickLabel(value: string, rangeMs: number) {
  const date = new Date(value);
  if (rangeMs > 2 * 86400000)
    return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
