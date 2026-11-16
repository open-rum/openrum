import type { RetentionResult } from "@/lib/api/analytics";

const WEEK = 7 * 24 * 3_600_000;

/** Cohort weeks follow the query's UTC Monday boundaries; `to` is exclusive. */
export function retentionCell(
  data: Pick<RetentionResult, "from" | "to">,
  cohort: RetentionResult["cohorts"][number],
  weekIndex: number,
  now = Date.now(),
): { label: string; description: string; rate?: number } {
  const start = Date.parse(cohort.cohortWeek) + weekIndex * WEEK;
  const end = start + WEEK;
  const from = Date.parse(data.from);
  const to = Date.parse(data.to);
  if (start >= now) return { label: "待观察", description: "该自然周尚未开始" };
  if (start >= to || end <= from)
    return { label: "范围外", description: "该自然周不在当前查询范围内" };
  if (cohort.users === 0) return { label: "无数据", description: "没有可用的起始用户" };
  const point = cohort.retention.find((item) => item.weekIndex === weekIndex);
  const partial = end > Math.min(to, now) || start < from;
  if (!point && partial)
    return { label: "观察中", description: "当前只覆盖部分自然周，尚未观测到回访" };
  // The query emits a point only for an observed active week. A missing, fully
  // queried week is a measured zero, while future/out-of-range weeks remain unknown.
  const rate = point?.rate ?? 0;
  return {
    label: `${(rate * 100).toFixed(0)}%${partial ? " · 部分周" : ""}`,
    description: `${point?.users ?? 0} 位用户${partial ? "；仅统计当前范围覆盖的部分自然周" : "；完整观察周"}`,
    rate,
  };
}
