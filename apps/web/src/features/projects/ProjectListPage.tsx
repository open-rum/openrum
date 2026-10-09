import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CircleAlertIcon,
  Clock3Icon,
  EyeIcon,
  FolderKanbanIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sparkline } from "@/lib/charts/Sparkline";
import { TIME_SERIES_MAX_POINTS, bucketRows, type TimeSeriesRow } from "@/lib/charts/timeSeries";
import { getOverview, type OverviewResponse } from "@/lib/api/client";
import {
  canManageProjects,
  listOrganizations,
  listProjects,
  type Project,
} from "@/lib/api/projects";
import { rememberProject } from "@/lib/projects/currentProject";
import { cn } from "@/lib/utils";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { buildHeatmap } from "./heatmapLayout";
import { ProjectPlatformIcon, getProjectPlatform } from "./projectPlatforms";

const DAY = 24 * 60 * 60 * 1000;
const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const views = [
  {
    value: "table",
    label: "表格",
    icon: ListIcon,
    scope: "最近 24 小时",
    description: "对齐指标，横向比较各项目",
  },
  {
    value: "cards",
    label: "卡片",
    icon: LayoutGridIcon,
    scope: "最近 30 天",
    description: "每格一天，看出项目的活跃节奏",
  },
] as const;
type ProjectView = (typeof views)[number]["value"];
const viewStorageKey = "openrum-project-list-view";

// Older builds stored "compact" or "trends"; anything unknown falls back to the table.
function initialView(): ProjectView {
  try {
    return localStorage.getItem(viewStorageKey) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}

export function ProjectListPage() {
  const [view, setView] = useState<ProjectView>(initialView);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });
  const organizations = useMemo(
    () => organizationsQuery.data?.organizations ?? [],
    [organizationsQuery.data],
  );
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const organization = organizations.find((item) => item.id === organizationId);
  const projectsQuery = useQuery({
    queryKey: ["projects", organizationId],
    queryFn: () => listProjects(organizationId),
    enabled: Boolean(organizationId),
  });
  const projects = projectsQuery.data?.projects ?? [];
  const current = views.find((item) => item.value === view) ?? views[0];

  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="项目"
        description="确认各项目是否持续上报、访问规模与错误情况，进入项目或项目设置。"
        actions={
          <>
            {organizations.length > 1 ? (
              <Select value={organizationId} onValueChange={setSelectedOrganizationId}>
                <SelectTrigger aria-label="组织" className="min-w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {organizations.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
            {organization && !canManageProjects(organization.role) ? (
              <Button disabled>
                <PlusIcon data-icon="inline-start" />
                创建项目
              </Button>
            ) : (
              <Button asChild>
                <Link to="/projects/new">
                  <PlusIcon data-icon="inline-start" />
                  创建项目
                </Link>
              </Button>
            )}
          </>
        }
      />

      {organizationsQuery.isLoading || (organizationId && projectsQuery.isLoading) ? (
        <ProjectListSkeleton />
      ) : null}
      {organizationsQuery.error || projectsQuery.error ? (
        <AsyncError
          error={organizationsQuery.error ?? projectsQuery.error}
          title="项目列表加载失败"
          remediation="请检查 API 服务后重试，当前项目数据不会被修改。"
          onRetry={() => {
            void organizationsQuery.refetch();
            void projectsQuery.refetch();
          }}
        />
      ) : null}
      {!organizationsQuery.isLoading &&
      !projectsQuery.isLoading &&
      !organizationsQuery.error &&
      !projectsQuery.error &&
      projects.length === 0 ? (
        <div className="border border-border bg-card">
          <EmptyState
            icon={FolderKanbanIcon}
            title="还没有项目"
            description={
              organization && !canManageProjects(organization.role)
                ? "当前角色不能创建项目，请联系组织 Owner 或 Admin。"
                : "创建第一个项目后，我们会继续引导你安装 SDK 并验证第一条事件。"
            }
          />
          {organization && canManageProjects(organization.role) ? (
            <div className="flex justify-center pb-8">
              <Button asChild>
                <Link to="/projects/new">
                  <PlusIcon data-icon="inline-start" />
                  创建第一个项目
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {projects.length ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-medium">
              {projects.length} 个项目
              <span className="ml-2 font-normal text-muted-foreground">
                {current.scope} · 全部环境 · {current.description}
              </span>
            </p>
            <ToggleGroup
              type="single"
              value={view}
              variant="selection"
              aria-label="项目展示方式"
              className="max-w-full rounded-full border bg-card p-1"
              onValueChange={(value) => {
                const next = views.find((item) => item.value === value)?.value;
                if (!next) return;
                setView(next);
                try {
                  localStorage.setItem(viewStorageKey, next);
                } catch {
                  /* Preference storage is optional. */
                }
              }}
            >
              {views.map(({ value, label, icon: Icon }) => (
                <ToggleGroupItem key={value} value={value}>
                  <Icon />
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {view === "table" ? (
            <div className="overflow-x-auto rounded-xl border bg-card" aria-label="项目列表">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>项目</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>24h PV</TableHead>
                    <TableHead>24h UV</TableHead>
                    <TableHead>错误事件</TableHead>
                    <TableHead>PV 趋势</TableHead>
                    <TableHead>最近上报</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">操作</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((project) => (
                    <ProjectTableRow key={project.id} project={project} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="项目列表">
              {projects.map((project) => (
                <ProjectHeatmapCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </ConsolePage>
  );
}

const overviewTiming = { staleTime: 30_000, refetchInterval: 60_000 };

/** The previous 24 complete hours, for the comparison table. */
function useProjectSummary(project: Project) {
  return useQuery({
    queryKey: ["project-list-summary", project.id, "24h", TIME_SERIES_MAX_POINTS],
    queryFn: ({ signal }) => {
      const to = new Date();
      to.setUTCMinutes(0, 0, 0);
      return getOverview(
        {
          projectId: project.id,
          from: new Date(to.getTime() - DAY),
          to,
        },
        signal,
        TIME_SERIES_MAX_POINTS,
      );
    },
    ...overviewTiming,
  });
}

/**
 * Thirty UTC days ending today, for the heatmap. Just under 30 days, so the shared
 * policy resolves to daily buckets; the last one is today and still filling.
 */
function useProjectActivity(project: Project) {
  return useQuery({
    queryKey: ["project-list-activity", project.id, "30d", TIME_SERIES_MAX_POINTS],
    queryFn: ({ signal }) => {
      const to = new Date();
      const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - 29));
      return getOverview({ projectId: project.id, from, to }, signal, TIME_SERIES_MAX_POINTS);
    },
    ...overviewTiming,
  });
}

function ProjectTableRow({ project }: { project: Project }) {
  const query = useProjectSummary(project);
  const data = query.data;
  return (
    <TableRow>
      <TableCell className="py-4">
        <div className="flex items-center gap-3">
          <ProjectPlatformIcon platform={project.sdkPlatform} className="size-5" />
          <div className="min-w-0">
            <ProjectNameLink project={project} className="block max-w-52" />
            <p className="mt-1 text-xs text-muted-foreground">
              {getProjectPlatform(project.sdkPlatform).label}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={project.status} />
      </TableCell>
      {data ? (
        <>
          <TableCell className="tabular-nums">{formatMetric(data.kpis.pageViews.value)}</TableCell>
          <TableCell className="tabular-nums">
            {data.kpis.uniqueUsers.approximate ? "≈" : ""}
            {formatMetric(data.kpis.uniqueUsers.value)}
          </TableCell>
          <TableCell className="tabular-nums">
            {formatMetric(data.kpis.errorRate.numerator)}
          </TableCell>
          <TableCell>
            <PageViewSparkline overview={data} />
          </TableCell>
          <TableCell>
            <FreshnessLabel freshness={data.freshness} />
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={5}>
          {query.isError ? (
            <span className="text-muted-foreground">摘要暂不可用</span>
          ) : (
            <Skeleton className="h-6" aria-label="正在加载项目摘要" />
          )}
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <ProjectEntry project={project} />
          <ProjectSettingsLink project={project} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function PageViewSparkline({ overview }: { overview: OverviewResponse }) {
  const rows = bucketRows(
    overview.series.map((point) => ({ bucket: point.bucket, pageViews: point.pageViews.value })),
    overview,
  );
  const values = rows.map((row) => {
    const value = (row as TimeSeriesRow).pageViews;
    return typeof value === "number" ? value : null;
  });
  const hasActivity = overview.kpis.pageViews.value > 0 || values.some((value) => (value ?? 0) > 0);
  return hasActivity ? (
    <Sparkline values={values} color="var(--ds-chart-1)" className="h-8 w-28" />
  ) : (
    <span className="text-xs text-muted-foreground">暂无访问</span>
  );
}

function ProjectHeatmapCard({ project }: { project: Project }) {
  const query = useProjectActivity(project);
  const data = query.data;
  const heatmap = data
    ? buildHeatmap(
        data,
        data.series.map((point) => ({ bucket: point.bucket, value: point.pageViews.value })),
      )
    : null;

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ProjectPlatformIcon platform={project.sdkPlatform} className="size-5" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">
              <ProjectNameLink project={project} className="block" />
            </CardTitle>
            <CardDescription className="truncate">
              {getProjectPlatform(project.sdkPlatform).label}
            </CardDescription>
          </div>
        </div>
        <CardAction className="flex items-center gap-1">
          <StatusBadge status={project.status} />
          <ProjectSettingsLink project={project} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {data && heatmap ? (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <HeatmapStat icon={EyeIcon} label="30 天 PV" value={formatMetric(heatmap.total)} />
              <HeatmapStat
                icon={SunIcon}
                label="活跃天数"
                value={`${heatmap.activeDays}/${heatmap.cells.length}`}
              />
              <HeatmapStat
                icon={CircleAlertIcon}
                label="错误事件"
                value={formatMetric(data.kpis.errorRate.numerator)}
              />
            </dl>
            <ActivityHeatmap heatmap={heatmap} />
          </>
        ) : query.isError || (data && !heatmap) ? (
          <p className="py-6 text-sm text-muted-foreground" role="status">
            活动数据暂不可用，仍可进入项目。
          </p>
        ) : (
          <Skeleton className="h-36" aria-label="正在加载项目活动" />
        )}
        {heatmap && !heatmap.hasData ? (
          <p className="text-xs text-muted-foreground">暂无访问数据，完成 SDK 接入后会逐日点亮。</p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {data ? <FreshnessLabel freshness={data.freshness} /> : null}
        </div>
        <ProjectEntry project={project} />
      </CardFooter>
    </Card>
  );
}

function HeatmapStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof EyeIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="truncate text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ProjectNameLink({ project, className }: { project: Project; className?: string }) {
  return (
    <Link
      className={cn("truncate font-medium hover:underline", className)}
      title={project.name}
      to="/projects/$projectId/analytics"
      params={{ projectId: project.id }}
      onClick={() => rememberProject(project)}
    >
      {project.name}
    </Link>
  );
}

function ProjectEntry({ project }: { project: Project }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to="/projects/$projectId/analytics"
        params={{ projectId: project.id }}
        onClick={() => rememberProject(project)}
      >
        进入项目<span className="sr-only">：{project.name}</span>
      </Link>
    </Button>
  );
}

function ProjectSettingsLink({ project }: { project: Project }) {
  return (
    <Button asChild size="icon-sm" variant="ghost">
      <Link
        to="/settings/project/$projectId/general"
        params={{ projectId: project.id }}
        onClick={() => rememberProject(project)}
        aria-label={`项目设置：${project.name}`}
        title="项目设置"
      >
        <SettingsIcon />
      </Link>
    </Button>
  );
}

function StatusBadge({ status }: { status: Project["status"] }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="project-status-dot" data-status={status} aria-hidden="true" />
      {statusLabel(status)}
    </Badge>
  );
}

function FreshnessLabel({ freshness }: { freshness: OverviewResponse["freshness"] }) {
  if (!freshness.latestReceivedAt || freshness.ageSeconds === null) {
    return <Badge variant="outline">等待上报</Badge>;
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock3Icon className="size-3.5 shrink-0" aria-hidden="true" />{" "}
      {formatRelativeTime(freshness.ageSeconds)}上报
    </span>
  );
}

function ProjectListSkeleton() {
  return <Skeleton className="h-64" aria-label="正在加载项目" />;
}

function formatMetric(value: number) {
  return compactNumber.format(value);
}

function formatRelativeTime(seconds: number) {
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  if (seconds < 24 * 3600) return `${Math.round(seconds / 3600)} 小时前`;
  return `${Math.round(seconds / (24 * 3600))} 天前`;
}

function statusLabel(status: Project["status"]) {
  return { active: "已启用", disabled: "已停用", deleting: "删除中" }[status];
}
