import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ListTreeIcon, RefreshCwIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { useBehaviorFilters } from "@/features/analytics/useBehaviorFilters";
import { getBehaviorAnalytics } from "@/lib/api/analytics";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import { searchErrorFrom } from "@/lib/api/search";
import { EventExplorer } from "./EventExplorer";
import { EventFilterComposer } from "./EventFilterComposer";
import { rollupSplit, tooExpensive } from "./searchCost";

export function EventsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <EventsSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={ListTreeIcon}
        title="尚未接入项目"
        description="创建项目并上报行为事件后，即可浏览事件目录。"
      />
    );
  // Keyed so a project switch starts clean instead of dimming the previous project's figures.
  return <ProjectEvents key={project.id} project={project} />;
}

function ProjectEvents({ project }: { project: Project }) {
  const { filters, update } = useBehaviorFilters(project.id);
  // The shared point budget is part of the request, and so of the cache key, but not of the
  // page's URL: it is the Console's policy, not something a person chose. Measurements are
  // read in the event drawer; the page shows no breakdown of them, so an old link's
  // measurement= is not sent.
  const request = useMemo(
    () => ({ ...filters, measurement: undefined, maxPoints: TIME_SERIES_MAX_POINTS }),
    [filters],
  );
  const query = useQuery({
    queryKey: ["event-explorer", request],
    queryFn: ({ signal }) => getBehaviorAnalytics(request, signal),
    // Changing a filter keeps the previous figures on screen, dimmed, instead of blanking
    // the whole page to a skeleton on every click.
    placeholderData: keepPreviousData,
  });
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="事件管理与探索"
        description="检查事件目录、趋势、属性定义和脱敏原始样本，并沿会话时间线复现行为。"
        actions={
          <Button
            size="icon"
            variant="outline"
            aria-label="刷新事件数据"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon className={query.isFetching ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <ConsoleFilterBar
        primary={
          <EventFilterComposer
            filters={filters}
            data={query.data}
            error={searchErrorFrom(query.error)}
            onChange={update}
          />
        }
      />
      <ConsolePageContent className="grid gap-6">
        {query.isLoading ? <EventsSkeleton compact /> : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title={tooExpensive(query.error, filters.q) ? "这个搜索的范围太大" : "事件探索加载失败"}
            remediation={
              tooExpensive(query.error, filters.q)
                ? "这个搜索要逐条读取原始事件，选中一个事件时最多查 7 天，不选时最多 1 天。可以选一个事件或缩短时间范围；只有一个国家、设备、浏览器或属性条件时，把分布卡片改为按同一维度拆分，就能用汇总数据查完整范围。"
                : "筛选已保留；请缩短范围、改用内置维度或清除高基数属性。"
            }
            onRetry={() => void query.refetch()}
            action={(() => {
              const split = tooExpensive(query.error, filters.q)
                ? rollupSplit(filters.q)
                : undefined;
              return split && split.dimension !== filters.dimension ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => update({ dimension: split.dimension })}
                >
                  改为{split.label}
                </Button>
              ) : undefined;
            })()}
          />
        ) : null}
        {query.data ? (
          <EventExplorer
            data={query.data}
            filters={filters}
            isFetching={query.isFetching}
            onSelectEvent={(eventKind, eventName) => update({ eventKind, eventName })}
            onChangeDimension={(dimension) => update({ dimension })}
          />
        ) : null}
      </ConsolePageContent>
    </ConsolePage>
  );
}

function EventsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "grid gap-4 lg:grid-cols-[20rem_1fr]" : "behavior-page"}
      aria-label="正在加载事件探索"
    >
      <Skeleton className="h-24" />
      <Skeleton className="h-96" />
    </div>
  );
}
