import { useQuery } from "@tanstack/react-query";
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
import { EventExplorer } from "./EventExplorer";
import { EventFilterComposer } from "./EventFilterComposer";

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
  return <ProjectEvents project={project} />;
}

function ProjectEvents({ project }: { project: Project }) {
  const { filters, update } = useBehaviorFilters(project.id);
  const query = useQuery({
    queryKey: ["event-explorer", filters],
    queryFn: ({ signal }) => getBehaviorAnalytics(filters, signal),
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
            <RefreshCwIcon />
          </Button>
        }
      />
      <ConsoleFilterBar
        primary={<EventFilterComposer filters={filters} data={query.data} onChange={update} />}
      />
      <ConsolePageContent className="grid gap-6">
        {query.isLoading ? <EventsSkeleton compact /> : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title="事件探索加载失败"
            remediation="筛选已保留；请缩短范围、改用内置维度或清除高基数属性。"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data ? (
          <EventExplorer
            data={query.data}
            filters={filters}
            onSelectEvent={(eventKind, eventName) => update({ eventKind, eventName })}
            onSelectProperty={(name) => update({ dimension: `property:${name}` })}
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
