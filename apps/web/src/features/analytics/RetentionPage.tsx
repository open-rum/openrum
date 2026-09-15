import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { RefreshCwIcon, UsersRoundIcon } from "lucide-react";
import { useMemo } from "react";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageHeader,
  ConsolePageTabs,
} from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import { Skeleton } from "@/components/ui/skeleton";
import { getRetention } from "@/lib/api/analytics";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { AnalysisTabs } from "./AnalysisTabs";

export function RetentionPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <RetentionSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={UsersRoundIcon}
        title="尚未接入项目"
        description="接入行为事件后即可查看周留存。"
      />
    );
  return <ProjectRetention project={project} />;
}

function ProjectRetention({ project }: { project: Project }) {
  const analysisContext = useAnalysisContext();
  const to = useMemo(() => roundedMinute(new Date()), []);
  const input = {
    projectId: project.id,
    from: analysisContext?.from ?? new Date(to.getTime() - 28 * 24 * 3_600_000),
    to: analysisContext?.to ?? to,
    environment: analysisContext?.environment,
    weeks: 4 as const,
  };
  const query = useQuery({
    queryKey: ["retention", input],
    queryFn: ({ signal }) => getRetention(input, signal),
  });
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="周留存"
        description="按用户首次出现在所选范围的自然周分组，观察后续每周是否再次活跃。"
        actions={
          <Button
            size="icon"
            variant="outline"
            aria-label="刷新周留存"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon />
          </Button>
        }
      />
      <ConsolePageTabs>
        <AnalysisTabs projectId={project.id} active="retention" />
      </ConsolePageTabs>
      <ConsoleFilterBar
        primary={
          <span className="behavior-toolbar__note">
            展示 4 个自然周 · 首次出现基于全局范围 · 不进行跨设备合并
          </span>
        }
      />
      {query.isLoading ? <RetentionSkeleton compact /> : null}
      {query.error ? (
        <AsyncError
          error={query.error}
          title="周留存加载失败"
          remediation="请缩短留存范围后重试。"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data ? <RetentionMatrix data={query.data} /> : null}
    </ConsolePage>
  );
}

function RetentionMatrix({ data }: { data: Awaited<ReturnType<typeof getRetention>> }) {
  if (data.cohorts.length === 0)
    return (
      <div className="behavior-panel">
        <EmptyState
          icon={UsersRoundIcon}
          title="当前范围没有留存数据"
          description="至少需要两个自然周的匿名用户行为数据。"
        />
      </div>
    );
  return (
    <section className="behavior-panel retention-panel" aria-labelledby="retention-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="retention-title">留存矩阵</h2>
          <p>W0 为 cohort 用户数；后续单元格显示回访比例。</p>
        </div>
        <span>近似统计</span>
      </div>
      <div className="retention-table-wrap">
        <table className="retention-table">
          <thead>
            <tr>
              <th>首次活跃周</th>
              <th>用户</th>
              {Array.from({ length: data.weeks }, (_, index) => (
                <th key={index}>W{index}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.cohorts.map((cohort) => {
              const points = new Map(cohort.retention.map((point) => [point.weekIndex, point]));
              return (
                <tr key={cohort.cohortWeek}>
                  <th>{formatWeek(cohort.cohortWeek)}</th>
                  <td>{cohort.users.toLocaleString()}</td>
                  {Array.from({ length: data.weeks }, (_, weekIndex) => {
                    const point = points.get(weekIndex);
                    return (
                      <td key={weekIndex}>
                        {point ? (
                          <span
                            className="retention-cell"
                            style={{
                              // --ds-primary rather than --ds-brand: the cell is
                              // a filled mark, and brand is darkened for text
                              // contrast in light mode, which tints the whole
                              // grid olive. See docs/design.md.
                              backgroundColor: `color-mix(in srgb, var(--ds-primary) ${Math.max(point.rate * 82, 10)}%, var(--ds-surface))`,
                            }}
                            title={`${point.users} 位用户`}
                          >
                            {(point.rate * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="retention-cell retention-cell--empty">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="retention-footnote">
        口径：所选范围内第一次行为所在周为
        cohort；后续自然周再次出现即记为留存。浏览器清理标识会被视为新用户。
      </p>
    </section>
  );
}

function RetentionSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-4" : "behavior-page"} aria-label="正在加载周留存">
      <Skeleton className="h-24" />
      <Skeleton className="h-14" />
      <Skeleton className="h-96" />
    </div>
  );
}
function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}
function formatWeek(value: string) {
  return `${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value))} 起`;
}
