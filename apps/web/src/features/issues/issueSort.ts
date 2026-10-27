import type { IssueFilters } from "@/lib/api/issues";

/** The list's orders, each with the line that says what it puts first. */
export const issueSorts: Array<{ value: IssueFilters["sort"]; label: string; hint: string }> = [
  { value: "last_seen", label: "最近发生", hint: "最近一次发生的时间" },
  { value: "first_seen", label: "首次发生", hint: "第一次发生的时间，新问题在前" },
  { value: "trend", label: "趋势", hint: "时间范围后半段比前半段增加最多" },
  { value: "events", label: "事件数", hint: "错误事件的数量" },
  { value: "users", label: "影响用户", hint: "受影响的用户数" },
];
