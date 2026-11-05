import { BugIcon } from "lucide-react";
import type { OverviewResponse } from "@/lib/api/client";
import type { OverviewFilters } from "@/lib/filters/schema";
import { serializeOverviewFilters } from "@/lib/filters/schema";

export function TopIssues({
  issues,
  filters,
}: {
  issues: OverviewResponse["topIssues"];
  filters: OverviewFilters;
}) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
        <h2 className="card-title">Top 问题</h2>
        <p className="text-sm text-base-content/70">按受影响用户排序，保留当前时间与环境筛选。</p>
        <TopIssuesContent issues={issues} filters={filters} />
      </div>
    </div>
  );
}

export function TopIssuesContent({
  issues,
  filters,
}: {
  issues: OverviewResponse["topIssues"];
  filters: OverviewFilters;
}) {
  return (
    <>
      {issues.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-center">
          <BugIcon className="mb-1 size-6 opacity-40" aria-hidden="true" />
          <p className="font-medium">当前没有可排名的问题</p>
          <p className="text-sm text-base-content/70">
            错误指纹聚合将在问题模型启用后显示；原始错误仍会进入事件存储。
          </p>
        </div>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>问题</th>
              <th>用户</th>
              <th>事件</th>
              <th>最近发生</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => (
              <tr key={issue.fingerprint}>
                <td>{index + 1}</td>
                <td>
                  <a
                    className="link link-hover font-medium"
                    href={issueURL(issue.fingerprint, filters)}
                  >
                    {issue.title}
                  </a>
                  <code className="mt-1 block max-w-72 truncate text-xs text-base-content/70">
                    {issue.fingerprint}
                  </code>
                </td>
                <td>{issue.users.toLocaleString()}</td>
                <td>{issue.events.toLocaleString()}</td>
                <td>
                  {issue.lastSeenAt ? new Date(issue.lastSeenAt).toLocaleString("zh-CN") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function issueURL(fingerprint: string, filters: OverviewFilters) {
  const parameters = serializeOverviewFilters(filters);
  return `/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(fingerprint)}?${parameters.toString()}`;
}
