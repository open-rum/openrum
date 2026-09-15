import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  CircleAlertIcon,
  Clock3Icon,
  EyeIcon,
  FolderKanbanIcon,
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
import { getOverview, type OverviewResponse } from "@/lib/api/client";
import {
  canManageProjects,
  listOrganizations,
  listProjects,
  type Project,
} from "@/lib/api/projects";
import { rememberProject } from "@/lib/projects/currentProject";

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

export function ProjectListPage() {
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
      {!organizationsQuery.isLoading && !projectsQuery.isLoading && projects.length === 0 ? (
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
        <div className="grid gap-4 lg:grid-cols-2" aria-label="项目列表">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : null}
    </ConsolePage>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const overviewQuery = useQuery({
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
  const overview = overviewQuery.data;

  return (
    <Card className="min-h-88">
      <CardHeader className="border-b">
        <CardTitle>{project.name}</CardTitle>
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
  const data = overview.series.map((point) => ({
    bucket: point.bucket,
    pageViews: point.pageViews.value,
  }));
  const hasActivity =
    overview.kpis.pageViews.value > 0 || data.some((point) => point.pageViews > 0);

  return (
    <>
      <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
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

      <section className="flex flex-1 flex-col gap-2" aria-label="最近 24 小时 PV 趋势">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">PV 趋势</h3>
            <p className="text-xs text-muted-foreground">最近 24 小时 · 反映项目访问活跃度</p>
          </div>
          <FreshnessLabel freshness={overview.freshness} />
        </div>
        {hasActivity ? (
          <ChartContainer
            className="h-28 w-full aspect-auto"
            config={activityChartConfig}
            initialDimension={{ width: 480, height: 112 }}
            role="img"
            aria-label="最近 24 小时 PV 折线图"
          >
            <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid
                vertical={false}
                stroke="var(--ds-border-soft)"
                strokeDasharray="2 3"
              />
              <XAxis
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
                type="linear"
                dataKey="pageViews"
                stroke="var(--color-pageViews)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <Empty className="h-28 gap-2 rounded-lg border border-border p-3">
            <EmptyHeader className="gap-1">
              <EmptyTitle>暂无访问数据</EmptyTitle>
              <EmptyDescription className="text-xs">
                完成 SDK 接入后将在这里展示趋势。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </>
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
        <Icon aria-hidden="true" /> {label}
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
      <Clock3Icon aria-hidden="true" /> {formatRelativeTime(freshness.ageSeconds)}上报
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
