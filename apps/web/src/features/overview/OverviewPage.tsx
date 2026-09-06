import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getOverview } from "@/lib/api/client";
import { useFilters } from "@/lib/filters/useFilters";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import { FreshnessBanner } from "./FreshnessBanner";
import { MetricCards } from "./MetricCards";
import { isOverviewEmpty } from "./state";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";

const OverviewAnalysis = lazy(() => import("./OverviewAnalysis"));

export function OverviewPage() {
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project =
    projects.data?.projects.find((item) => item.id === routeProjectId) ??
    projects.data?.projects[0];

  if (organizations.isLoading || projects.isLoading) return <OverviewShellSkeleton />;
  if (!project) return <NoProject />;
  return <ProjectOverview project={project} />;
}

function ProjectOverview({ project }: { project: Project }) {
  useEffect(() => {
    recordProductEvent("overview_viewed", project.id);
  }, [project.id]);
  const context = useAnalysisContext();
  const { filters: pageFilters, updateFilters } = useFilters(project.id);
  const filters = context
    ? {
        ...pageFilters,
        from: context.from,
        to: context.to,
        environment: context.environment,
      }
    : pageFilters;
  const overview = useQuery({
    queryKey: [
      "overview",
      project.id,
      filters.from.toISOString(),
      filters.to.toISOString(),
      filters.environment,
      filters.release,
      filters.route,
    ],
    queryFn: ({ signal }) => getOverview(filters, signal),
  });
  const data = overview.data;
  const empty = data ? isOverviewEmpty(data) : false;

  return (
    <div className="overview-page">
      <header className="page-header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> 数据大盘
          </div>
          <div className="title-line">
            <h1>
              {!filters.environment
                ? "全部环境概览"
                : filters.environment === "production"
                  ? "生产环境概览"
                  : `${filters.environment} 环境概览`}
            </h1>
          </div>
        </div>
        <div className="header-controls">
          <label className="select-control">
            <span>版本</span>
            <input
              value={filters.release ?? ""}
              placeholder="全部版本"
              onChange={(event) =>
                updateFilters(
                  { release: event.target.value || undefined, cursor: undefined },
                  "replace",
                )
              }
            />
          </label>
          <label className="select-control">
            <span>路由</span>
            <input
              value={filters.route ?? ""}
              placeholder="全部路由"
              onChange={(event) =>
                updateFilters(
                  { route: event.target.value || undefined, cursor: undefined },
                  "replace",
                )
              }
            />
          </label>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="刷新数据"
            onClick={() => void overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </header>

      {overview.isLoading ? <MetricCards loading /> : null}
      {overview.error ? (
        <OverviewError error={overview.error} onRetry={() => void overview.refetch()} />
      ) : null}
      {data && !empty ? (
        <>
          <div className="flex justify-end">
            <FreshnessBanner freshness={data.freshness} />
          </div>
          <MetricCards data={data} />
          <Suspense
            fallback={
              <div className="grid gap-4 lg:grid-cols-2">
                <Skeleton className="h-80" />
                <Skeleton className="h-80" />
              </div>
            }
          >
            <OverviewAnalysis data={data} filters={filters} />
          </Suspense>
        </>
      ) : null}
      {data && empty ? (
        <Empty className="min-h-80 border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>这个范围内还没有真实事件</EmptyTitle>
            <EmptyDescription>
              可能尚未接入、采样后暂无事件，或筛选条件过窄。测试事件不会计入生产 KPI。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/projects/$projectId/onboarding" params={{ projectId: project.id }}>
                检查接入状态
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                updateFilters({ environment: undefined, release: undefined, route: undefined })
              }
            >
              清除筛选
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </div>
  );
}

function OverviewError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <AsyncError
      error={error}
      title="无法加载数据总览"
      remediation="当前筛选已保留；缩短时间范围，或检查 API 与 ClickHouse 后重试。"
      onRetry={onRetry}
    />
  );
}

function NoProject() {
  return (
    <Empty className="mx-auto mt-20 max-w-xl border border-border">
      <EmptyHeader>
        <EmptyTitle>先创建一个监控项目</EmptyTitle>
        <EmptyDescription>创建项目后，接入向导会带你完成 Browser SDK 验证。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to="/onboarding">创建项目</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function OverviewShellSkeleton() {
  return (
    <div className="overview-page">
      <Skeleton className="h-24" />
      <MetricCards loading />
      <Skeleton className="h-80" />
    </div>
  );
}
