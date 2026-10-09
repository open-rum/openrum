import type { IssueStatus } from "@/lib/api/issues";

export const issueStatusLabel: Record<IssueStatus, string> = {
  unresolved: "待处理",
  regressed: "已回归",
  resolved: "已解决",
  ignored: "已忽略",
};
