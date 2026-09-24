import { useMemo } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, GaugeIcon, SlidersHorizontalIcon } from "lucide-react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getProject, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { getUsage, usageRange, usageURL } from "@/lib/api/usage";
import { readUsageRange, usageTypes } from "./organizationUsage";

export function UsagePage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId!, signal),
    enabled: Boolean(projectId),
  });
  if (projectQuery.isLoading) return <UsageSkeleton />;
  if (projectQuery.error)
    return (
      <ConsolePage width="wide">
        <ConsolePageHeader title="用量统计" />
        <AsyncError
          title="项目加载失败"
          error={projectQuery.error}
          remediation="请确认项目存在且你有访问权限。"
          onRetry={() => void projectQuery.refetch()}
        />
      </ConsolePage>
    );
  const project = projectQuery.data;
  if (!project)
    return (
      <ConsolePage width="wide">
        <ConsolePageHeader title="用量统计" description="请先创建并接入项目。" />
      </ConsolePage>
    );
  return <ProjectUsage project={project} />;
}

function ProjectUsage({ project }: { project: Project }) {
  const fallback = useMemo(() => usageRange(7), []);
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const range = useMemo(
    () => readUsageRange(new URLSearchParams(search), fallback),
    [search, fallback],
  );
  const usage = useQuery({
    queryKey: [
      "usage",
      project.id,
      range.from.toISOString(),
      range.to.toISOString(),
      range.eventType,
    ],
    queryFn: ({ signal }) => getUsage(project.id, range, signal),
  });
  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="用量统计"
        description={`${project.name} · ${range.from.toLocaleString("zh-CN")} — ${range.to.toLocaleString("zh-CN")} · ${usageTypes.find(([type]) => type === range.eventType)?.[1] ?? "全部事件"}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/settings/project/$projectId/sampling" params={{ projectId: project.id }}>
                <SlidersHorizontalIcon data-icon="inline-start" />
                配置采样
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href={usageURL(project.id, range, true)} download>
                <DownloadIcon data-icon="inline-start" />
                导出 CSV
              </a>
            </Button>
          </>
        }
      />
      {usage.isLoading ? <UsageSkeleton compact /> : null}
      {usage.error ? (
        <div className="mt-6">
          <AsyncError
            error={usage.error}
            title="用量加载失败"
            remediation="可重新加载，或凭 Request ID 联系管理员。采样等配置可前往数据管理查看。"
            onRetry={() => void usage.refetch()}
          />
        </div>
      ) : null}
      {usage.data ? (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="用量摘要">
            {[
              ["已接收", usage.data.totals.accepted],
              ["估算原始", Math.round(usage.data.totals.estimated)],
              ["客户端采样", usage.data.totals.sampled],
              ["已拒绝", usage.data.totals.rejected],
              ["处理失败", usage.data.totals.failed],
              ["传输字节", formatBytes(usage.data.totals.bytes)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xl font-semibold">
                  {typeof value === "number" ? value.toLocaleString("zh-CN") : value}
                </CardContent>
              </Card>
            ))}
          </section>
          <section className="mt-8 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
              <GaugeIcon className="size-4" />
              <h2 className="font-semibold">原因明细</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">时间</th>
                    <th>事件</th>
                    <th>结果</th>
                    <th>原因</th>
                    <th className="text-right">数量</th>
                    <th className="px-5 text-right">估算</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {usage.data.breakdown
                    .slice(-20)
                    .reverse()
                    .map((row) => (
                      <tr key={`${row.bucket}:${row.eventType}:${row.outcome}:${row.reason}`}>
                        <td className="px-5 py-3">
                          {new Date(row.bucket).toLocaleString("zh-CN")}
                        </td>
                        <td>{row.eventType}</td>
                        <td>{row.outcome}</td>
                        <td>{row.reason || "—"}</td>
                        <td className="text-right">{row.events.toLocaleString()}</td>
                        <td className="px-5 text-right">
                          {Math.round(row.estimated).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </ConsolePage>
  );
}

function UsageSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <ConsolePage width="wide" className="flex flex-col gap-4" aria-label="正在加载用量">
      <Skeleton className={compact ? "h-28 w-full" : "h-12 w-64"} />
      <Skeleton className="h-56 w-full" />
    </ConsolePage>
  );
}

function formatBytes(value: number) {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
