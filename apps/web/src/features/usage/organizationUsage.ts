import { getUsage, type UsageResponse } from "@/lib/api/usage";
import type { Project } from "@/lib/api/projects";

export const usageTypes = [
  ["all", "全部事件"],
  ["page_view", "页面访问"],
  ["error", "错误"],
  ["web_vital", "性能"],
  ["api", "API"],
  ["custom", "自定义事件"],
  ["log", "日志"],
] as const;
export type UsageRange = { from: Date; to: Date; eventType?: string };
export type ProjectUsageResult = { project: Project; usage?: UsageResponse; unavailable?: true };
export const emptyTotals = () => ({
  accepted: 0,
  sampled: 0,
  rejected: 0,
  failed: 0,
  estimated: 0,
  bytes: 0,
});

export function readUsageRange(search: URLSearchParams, fallback: UsageRange): UsageRange {
  const from = new Date(search.get("from") ?? "");
  const to = new Date(search.get("to") ?? "");
  const valid =
    Number.isFinite(from.getTime()) &&
    Number.isFinite(to.getTime()) &&
    from < to &&
    to.getTime() - from.getTime() <= 90 * 86400000;
  const eventType = usageTypes.find(
    ([type]) => type !== "all" && type === search.get("eventType"),
  )?.[0];
  return { ...(valid ? { from, to } : fallback), eventType };
}

/** Existing per-project endpoints enforce membership; cap fan-out to four requests. */
export async function loadOrganizationUsage(
  projects: Project[],
  range: UsageRange,
  signal: AbortSignal,
): Promise<ProjectUsageResult[]> {
  const results: ProjectUsageResult[] = new Array(projects.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, projects.length) }, async () => {
      while (index < projects.length) {
        signal.throwIfAborted();
        const current = index++;
        const project = projects[current];
        try {
          results[current] = { project, usage: await getUsage(project.id, range, signal) };
        } catch {
          signal.throwIfAborted();
          results[current] = { project, unavailable: true };
        }
      }
    }),
  );
  return results;
}

export function summarizeUsage(results: ProjectUsageResult[], range?: UsageRange) {
  const totals = emptyTotals();
  const buckets = new Map<string, ReturnType<typeof emptyTotals> & { bucket: string }>();
  let unavailable = 0;
  let truncated = false;
  for (const result of results) {
    if (!result.usage) {
      unavailable++;
      continue;
    }
    const usage = result.usage;
    for (const key of Object.keys(totals) as (keyof typeof totals)[])
      totals[key] += usage.totals[key];
    // The current endpoint caps reason breakdowns at 5,000 rows, without a cursor.
    truncated ||= usage.breakdown.length >= 5000;
    for (const row of usage.breakdown) {
      const bucket = new Date(row.bucket).toISOString();
      const point = buckets.get(bucket) ?? { bucket, ...emptyTotals() };
      if (
        row.outcome === "accepted" ||
        row.outcome === "sampled" ||
        row.outcome === "rejected" ||
        row.outcome === "failed"
      )
        point[row.outcome] += row.events;
      buckets.set(bucket, point);
    }
  }
  const interval = results.find((result) => result.usage)?.usage?.intervalSeconds;
  if (range && interval && buckets.size && !truncated) {
    const step = interval * 1000;
    for (
      let time = Math.floor(range.from.getTime() / step) * step;
      time < range.to.getTime();
      time += step
    ) {
      const bucket = new Date(time).toISOString();
      if (!buckets.has(bucket)) buckets.set(bucket, { bucket, ...emptyTotals() });
    }
  }
  return {
    totals,
    unavailable,
    truncated,
    series: [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
}

export function projectUsageLink(projectId: string, range: UsageRange) {
  const search = new URLSearchParams({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  });
  if (range.eventType) search.set("eventType", range.eventType);
  return `/settings/project/${encodeURIComponent(projectId)}/usage?${search}`;
}

export function formatUsageBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
