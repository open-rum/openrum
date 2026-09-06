import type { UsageResponse } from "@/lib/api/usage";

export type SamplingImpact = {
  currentDaily: number;
  projectedDaily: number;
  deltaPercent: number;
  projectedDailyBytes: number;
};

export function calculateSamplingImpact(
  usage: UsageResponse,
  eventSampleRate: number,
  apiSampleRate: number,
): SamplingImpact {
  const days = Math.max(1 / 24, (Date.parse(usage.to) - Date.parse(usage.from)) / 86_400_000);
  const acceptedRows = usage.breakdown.filter((row) => row.outcome === "accepted");
  const projected = acceptedRows.reduce((sum, row) => {
    const rate =
      row.eventType === "error" ? 1 : row.eventType === "api" ? apiSampleRate : eventSampleRate;
    return sum + row.estimated * rate;
  }, 0);
  const currentDaily = usage.totals.accepted / days;
  const projectedDaily = projected / days;
  return {
    currentDaily,
    projectedDaily,
    deltaPercent: currentDaily > 0 ? ((projectedDaily - currentDaily) / currentDaily) * 100 : 0,
    projectedDailyBytes:
      usage.totals.accepted > 0
        ? (usage.totals.bytes * projected) / usage.totals.accepted / days
        : 0,
  };
}
