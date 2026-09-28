/** Direction a metric is better in. Neutral metrics are never toned good or bad. */
export type MetricDirection = "up" | "down" | "neutral";

/**
 * Change against the previous period, in the unit the classic overview uses: percentage
 * points for ratios, percent for everything else. Null when either side is missing or the
 * previous value is zero, so no change is ever invented.
 */
export function periodChange(
  current: number | null | undefined,
  previous: number | null | undefined,
  ratio: boolean,
): number | null {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  )
    return null;
  if (ratio) return (current - previous) * 100;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatChange(change: number | null, ratio: boolean): string {
  if (change === null || !Number.isFinite(change)) return "无对比";
  const precision = ratio ? 2 : 1;
  const rounded = Number(change.toFixed(precision));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(precision)}${ratio ? "pp" : "%"}`;
}

/** Tone for a change, given which way is better. A rounded zero is neutral. */
export function changeTone(
  change: number | null,
  ratio: boolean,
  direction: MetricDirection,
): "positive" | "negative" | "neutral" {
  if (change === null || !Number.isFinite(change) || direction === "neutral") return "neutral";
  const rounded = Number(change.toFixed(ratio ? 2 : 1));
  if (rounded === 0) return "neutral";
  return (direction === "down" ? rounded < 0 : rounded > 0) ? "positive" : "negative";
}
