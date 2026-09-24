import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  CircleAlertIcon,
  Clock3Icon,
  EyeIcon,
  FolderKanbanIcon,
  LayoutGridIcon,
  ChartNoAxesCombinedIcon,
  ListIcon,
  PlusIcon,
  PlugIcon,
  UsersIcon,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import { getOverview, type OverviewResponse } from "@/lib/api/client";
import {
  canManageProjects,
  listOrganizations,
  listProjects,
  type Project,
} from "@/lib/api/projects";
import { rememberProject } from "@/lib/projects/currentProject";
import { ProjectPlatformIcon, getProjectPlatform } from "./projectPlatforms";

const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const preciseNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const activityChartConfig = {
  pageViews: {
    label: "PV",
    color: "var(--ds-chart-1)",
  },
} satisfies ChartConfig;

const views = [
  {
    value: "compact",
    label: "轻量卡片",
    icon: LayoutGridIcon,
    description: "把项目身份和关键指标放在首位，适合快速进入项目。",
  },
  {
    value: "trends",
    label: "趋势卡片",
    icon: ChartNoAxesCombinedIcon,
    description: "展开访问趋势与配置信息，适合逐个观察项目。",
  },
  {
    value: "table",
    label: "数据表格",
    icon: ListIcon,
    description: "对齐所有项目的指标和上报时间，适合横向比较。",
  },
] as const;
type ProjectView = (typeof views)[number]["value"];
const viewStorageKey = "openrum-project-list-view";

function initialView(): ProjectView {
  try {
    const saved = localStorage.getItem(viewStorageKey);
    return views.find((view) => view.value === saved)?.value ?? "compact";
  } catch {
    return "compact";
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

  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="项目"
        description="快速确认项目是否持续上报、最近 24 小时的访问规模与错误情况。"
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
            <div>
              <p className="text-sm font-medium">
                {projects.length} 个项目{" "}
                <span className="ml-2 font-normal text-muted-foreground">
                  最近 24 小时 · 各项目默认环境
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {views.find((item) => item.value === view)?.description}
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={view}
              variant="selection"
              aria-label="项目展示方式"
              className="max-w-full flex-wrap rounded-lg border bg-card p-1"
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
            <div className="overflow-hidden rounded-xl border bg-card" aria-label="项目列表">
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
                    <TableHead>
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
            <div
              className={
                view === "compact"
                  ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
                  : "grid gap-5 lg:grid-cols-2"
              }
              aria-label="项目列表"
            >
              {projects.map((project) =>
                view === "compact" ? (
                  <CompactProjectCard key={project.id} project={project} />
                ) : (
                  <ProjectCard key={project.id} project={project} />
                ),
              )}
            </div>
          )}
        </div>
      ) : null}
    </ConsolePage>
  );
}

function useProjectOverview(project: Project) {
  return useQuery({
    queryKey: ["project-card-overview", project.id],
    queryFn: ({ signal }) => {
      const to = new Date();
      to.setUTCMinutes(0, 0, 0);
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      return getOverview(
        {
          projectId: project.id,
          from,
          to,
          environment: project.environment,
        },
        signal,
      );
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

function ProjectCard({ project }: { project: Project }) {
  const overviewQuery = useProjectOverview(project);
  const overview = overviewQuery.data;

  return (
    <Card className="min-h-88">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <ProjectPlatformIcon platform={project.sdkPlatform} className="size-4" />
          {project.name}
        </CardTitle>
        <CardDescription>
          {project.slug} · {project.environments?.length ?? 1} 个环境
        </CardDescription>
        <CardAction>
          <Badge variant={project.status === "active" ? "secondary" : "outline"}>
            {statusLabel(project.status)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {overview ? (
          <ProjectActivity overview={overview} />
        ) : overviewQuery.isError ? (
          <ProjectActivityUnavailable />
        ) : (
          <ProjectActivitySkeleton />
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ActivityIcon /> 默认 {project.environment}
          </span>
          <span aria-hidden="true">·</span>
          <span>{project.retentionDays} 天保留</span>
          <span aria-hidden="true">·</span>
          <span>{formatRate(project.eventSampleRate)} 采样</span>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/projects/$projectId/onboarding" params={{ projectId: project.id }}>
              <PlugIcon data-icon="inline-start" />
              接入
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link
              to="/projects/$projectId/analytics"
              params={{ projectId: project.id }}
              onClick={() => rememberProject(project)}
            >
              进入项目
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function ProjectActivity({ overview }: { overview: OverviewResponse }) {
  return (
    <>
      <ProjectMetrics overview={overview} />
      <section className="flex flex-1 flex-col gap-2" aria-label="最近 24 小时 PV 趋势">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">PV 趋势</h3>
            <p className="text-xs text-muted-foreground">最近 24 小时 · 反映项目访问活跃度</p>
          </div>
          <FreshnessLabel freshness={overview.freshness} />
        </div>
        <ProjectTrend overview={overview} />
      </section>
    </>
  );
}

function ProjectMetrics({ overview }: { overview: OverviewResponse }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border">
      <ProjectMetric
        icon={EyeIcon}
        label="24h PV"
        value={formatMetric(overview.kpis.pageViews.value)}
      />
      <ProjectMetric
        icon={UsersIcon}
        label="24h UV"
        value={`${overview.kpis.uniqueUsers.approximate ? "≈" : ""}${formatMetric(overview.kpis.uniqueUsers.value)}`}
      />
      <ProjectMetric
        icon={CircleAlertIcon}
        label="错误事件"
        value={formatMetric(overview.kpis.errorRate.numerator)}
      />
    </div>
  );
}

function ProjectTrend({
  overview,
  compact = false,
}: {
  overview: OverviewResponse;
  compact?: boolean;
}) {
  const animate = useChartMotion();
  const data = overview.series.map((point) => ({
    bucket: point.bucket,
    pageViews: point.pageViews.value,
  }));
  const hasActivity =
    overview.kpis.pageViews.value > 0 || data.some((point) => point.pageViews > 0);

  return hasActivity ? (
    <ChartContainer
      className={compact ? "h-12 w-full aspect-auto" : "h-28 w-full aspect-auto"}
      config={activityChartConfig}
      initialDimension={{ width: 480, height: 112 }}
      role="img"
      aria-label="最近 24 小时 PV 折线图"
    >
      <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        {!compact && (
          <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
        )}
        <XAxis
          hide={compact}
          dataKey="bucket"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={56}
          tickFormatter={(value: string) => timeFormatter.format(new Date(value))}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--ds-border-strong)" }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) => {
                const bucket = payload[0]?.payload?.bucket as string | undefined;
                return bucket ? dateTimeFormatter.format(new Date(bucket)) : "";
              }}
              formatter={(value) => (
                <div className="flex min-w-32 items-center justify-between gap-4">
                  <span className="text-muted-foreground">PV</span>
                  <span className="font-mono font-medium tabular-nums">
                    {preciseNumber.format(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <Line
          {...smoothCurve}
          dataKey="pageViews"
          stroke="var(--color-pageViews)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={animate}
        />
      </LineChart>
    </ChartContainer>
  ) : compact ? (
    <div className="flex h-12 items-center text-xs text-muted-foreground">暂无访问数据</div>
  ) : (
    <Empty className="h-28 gap-2 rounded-lg border border-border p-3">
      <EmptyHeader className="gap-1">
        <EmptyTitle>暂无访问数据</EmptyTitle>
        <EmptyDescription className="text-xs">完成 SDK 接入后将在这里展示趋势。</EmptyDescription>
      </EmptyHeader>
    </Empty>
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

function CompactProjectCard({ project }: { project: Project }) {
  const query = useProjectOverview(project);
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <ProjectPlatformIcon platform={project.sdkPlatform} className="size-5" />
          </div>
          <Badge variant="outline">{statusLabel(project.status)}</Badge>
        </div>
        <CardTitle className="truncate text-base" title={project.name}>
          {project.name}
        </CardTitle>
        <CardDescription className="truncate">
          {getProjectPlatform(project.sdkPlatform).label} · {project.slug} ·{" "}
          {project.environments?.length ?? 1} 个环境
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {query.data ? (
          <>
            <ProjectMetrics overview={query.data} />
            <ProjectTrend overview={query.data} compact />
            <FreshnessLabel freshness={query.data.freshness} />
          </>
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground" role="status">
            摘要暂不可用，仍可进入项目。
          </p>
        ) : (
          <Skeleton className="h-32" aria-label="正在加载项目摘要" />
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground" title={project.environment}>
          默认 {project.environment}
        </span>
        <ProjectEntry project={project} />
      </CardFooter>
    </Card>
  );
}

function ProjectTableRow({ project }: { project: Project }) {
  const query = useProjectOverview(project);
  const data = query.data;
  return (
    <TableRow>
      <TableCell className="py-5">
        <div className="flex items-center gap-3">
          <ProjectPlatformIcon platform={project.sdkPlatform} className="size-5" />
          <div className="min-w-0">
            <Link
              className="block max-w-52 truncate font-medium hover:underline"
              title={project.name}
              to="/projects/$projectId/analytics"
              params={{ projectId: project.id }}
              onClick={() => rememberProject(project)}
            >
              {project.name}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              默认 {project.environment} · {project.environments?.length ?? 1} 个环境
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{statusLabel(project.status)}</Badge>
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
            <div className="w-28">
              <ProjectTrend overview={data} compact />
            </div>
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
        <ProjectEntry project={project} />
      </TableCell>
    </TableRow>
  );
}

function ProjectMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof EyeIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" /> {label}
      </span>
      <strong className="truncate text-base font-semibold tabular-nums">{value}</strong>
    </div>
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

function ProjectActivitySkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4" aria-label="正在加载项目摘要">
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}

function ProjectActivityUnavailable() {
  return (
    <Empty className="min-h-48 border border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ActivityIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>项目摘要暂时不可用</EmptyTitle>
        <EmptyDescription>仍可进入项目查看其他数据。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ProjectListSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-label="正在加载项目">
      {[0, 1].map((item) => (
        <Skeleton key={item} className="h-96" />
      ))}
    </div>
  );
}

function formatRate(value: number) {
  return `${Math.round(value * 100)}%`;
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
