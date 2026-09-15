import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, GaugeIcon } from "lucide-react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { getUsage, usageRange, usageURL } from "@/lib/api/usage";
import { SamplingForm } from "./SamplingForm";
import { ProjectSettingsNav } from "@/features/settings/ProjectSettingsNav";

export function UsagePage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <UsageSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <ConsolePage width="wide">
        <ConsolePageHeader title="用量与采样" description="请先创建并接入项目。" />
      </ConsolePage>
    );
  return <ProjectUsage project={project} />;
}

function ProjectUsage({ project }: { project: Project }) {
  const range = useMemo(() => usageRange(7), []);
  const usage = useQuery({
    queryKey: ["usage", project.id, range.from.toISOString(), range.to.toISOString()],
    queryFn: ({ signal }) => getUsage(project.id, range, signal),
  });
  return (
    <ConsolePage
      width="wide"
      rail={<ProjectSettingsNav projectId={project.id} />}
      railLabel="项目设置导航"
    >
      <ConsolePageHeader
        title="用量与采样"
        description="解释最近 7 天每一类事件的接收、采样丢弃、拒绝与处理失败。"
        actions={
          <Button asChild variant="outline">
            <a href={usageURL(project.id, range, true)} download>
              <DownloadIcon data-icon="inline-start" />
              导出 CSV
            </a>
          </Button>
        }
      />
      {usage.isLoading ? <UsageSkeleton compact /> : null}
      {usage.error ? (
        <div className="mt-6">
          <AsyncError
            error={usage.error}
            title="用量加载失败"
            remediation="当前采样配置未改变；可重新加载，或凭 Request ID 联系管理员。"
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
          <section className="mt-8">
            <SamplingForm project={project} usage={usage.data} />
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
