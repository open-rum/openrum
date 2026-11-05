import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ActivityIcon, FlaskConicalIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  defaultPerformanceFilters,
  formatPerformanceMetric,
  getPerformance,
  serializePerformanceFilters,
  performanceMetricNames,
  type PerformanceMetricKey,
  type PerformancePercentile,
  type PerformanceFilters,
  type PerformanceMetricName,
} from "@/lib/api/performance";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { PercentileSelect } from "./PerformanceControls";
import { RouteDetail } from "./RouteDetail";
import { previousRange } from "./routeDetailModel";
import { PerformanceOverview } from "./PerformanceOverview";
import { performanceRating, ratingBadge, ratingLabel, type PerformanceRating } from "./score";
import "./performance.css";

// Development-only shortcut to the dev-data dialog with the web-vitals preset. The lazy import
// sits inside the branch so a production bundle carries no reference to the generator.
const DevDataQuickEntry = import.meta.env.DEV
  ? lazy(() =>
      import("@/features/devdata/DevDataPage").then((module) => ({
        default: module.DevDataQuickEntry,
      })),
    )
  : null;

export function PerformancePage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <PerformanceSkeleton />;
  if (organizations.error || projects.error)
    return (
      <ConsolePage width="fluid">
        <AsyncError
          error={organizations.error ?? projects.error}
          title="无法加载项目"
          remediation="检查连接后重试。"
          onRetry={() => {
            void organizations.refetch();
            void projects.refetch();
          }}
        />
      </ConsolePage>
    );
  const project = projectId
    ? projects.data?.projects.find((item) => item.id === projectId)
    : projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={ActivityIcon}
        title={projectId ? "项目不可用" : "尚未接入项目"}
        description="请确认项目权限，或创建项目并接入 SDK。"
      />
    );
  return <ProjectPerformance key={project.id} project={project} />;
}

function ProjectPerformance({ project }: { project: Project }) {
  const [initialNow] = useState(() => new Date());
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const filters = useMemo(
    () => defaultPerformanceFilters(project.id, new URLSearchParams(search), new Date(initialNow)),
    [project.id, search, initialNow],
  );
  const query = useQuery({
    queryKey: ["performance", project.id, serializePerformanceFilters(filters).toString()],
    queryFn: ({ signal }) => getPerformance(filters, signal),
    placeholderData: keepPreviousData,
  });
  // The route detail compares against the window of the same length just before this one.
  const previousFilters = useMemo(
    () => (filters.route ? { ...filters, ...previousRange(filters.from, filters.to) } : null),
    [filters],
  );
  const previous = useQuery({
    queryKey: [
      "performance",
      project.id,
      "previous",
      previousFilters ? serializePerformanceFilters(previousFilters).toString() : "",
    ],
    queryFn: ({ signal }) => getPerformance(previousFilters!, signal),
    enabled: Boolean(previousFilters),
  });
  const update = (patch: Partial<PerformanceFilters>) => {
    const parameters = serializePerformanceFilters({ ...filters, ...patch });
    window.history.pushState({}, "", `${window.location.pathname}?${parameters}`);
    window.dispatchEvent(new Event("openrum:urlchange"));
  };
  const percentile = filters.percentile ?? "p75";
  const hasSamples = query.data?.summary
    ? performanceMetricNames.some(
        (name) =>
          (query.data?.summary?.[name.toLowerCase() as PerformanceMetricKey]?.samples ?? 0) > 0,
      )
    : Boolean(
        query.data?.routes.some((route) =>
          performanceMetricNames.some(
            (name) => (route[name.toLowerCase() as PerformanceMetricKey]?.samples ?? 0) > 0,
          ),
        ),
      );
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        // A route detail takes the route as its title; the breadcrumb returns to the list.
        title={
          filters.route ? (
            <span className="font-mono break-all">{filters.route}</span>
          ) : (
            "真实用户性能"
          )
        }
        documentTitle={filters.route ? `${filters.route} · 真实用户性能` : "真实用户性能"}
        breadcrumbs={
          filters.route
            ? [
                {
                  label: "真实用户性能",
                  href: `${window.location.pathname}?${serializePerformanceFilters({ ...filters, route: undefined })}`,
                  onNavigate: () => update({ route: undefined }),
                },
                { label: <span className="font-mono">{filters.route}</span> },
              ]
            : undefined
        }
        description={
          filters.route && query.data?.summary
            ? `${query.data.summary.pageViews.toLocaleString()} 次页面浏览 · ${formatRange(filters.from, filters.to)}`
            : undefined
        }
        titleAside={
          DevDataQuickEntry ? (
            <Suspense fallback={null}>
              <DevDataQuickEntry
                projects={[project]}
                project={project}
                preset="web-vitals"
                trigger={
                  <button
                    type="button"
                    className="btn btn-sm btn-soft btn-warning"
                    title="本地开发 · 生成性能测试数据"
                  >
                    <FlaskConicalIcon className="size-4" aria-hidden="true" />
                    造性能数据
                    <span className="badge badge-xs badge-warning">开发</span>
                  </button>
                }
              />
            </Suspense>
          ) : null
        }
        // One percentile for the whole page: trend, vitals, routes and route detail.
        actions={
          <PercentileSelect value={percentile} onChange={(percentile) => update({ percentile })} />
        }
      />
      <ConsolePageContent className="grid gap-6">
        {query.isLoading ? <PerformanceSkeleton compact /> : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title="无法加载性能数据"
            remediation="当前筛选已保留；缩短时间范围后重新加载。"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data?.detail ? (
          <RouteDetail
            projectId={project.id}
            detail={query.data.detail}
            summary={query.data.summary}
            previousSummary={previous.data?.summary}
            previousTrend={previous.data?.detail?.trend}
            durationMs={filters.to.getTime() - filters.from.getTime()}
            range={query.data}
            percentile={percentile}
            onMetricChange={(metric) => update({ metric })}
          />
        ) : null}
        {query.data && !query.data.detail && hasSamples ? (
          <>
            <PerformanceOverview
              summary={query.data.summary}
              trend={query.data.trend}
              range={query.data}
              percentile={percentile}
            />
            <RoutesTable
              filters={filters}
              routes={query.data.routes}
              onSelect={(route) => update({ route })}
              onMetricChange={(metric) => update({ metric })}
            />
          </>
        ) : null}
        {query.data && !hasSamples ? (
          <div className="card card-border bg-base-100">
            <EmptyState
              icon={ActivityIcon}
              title="当前范围没有性能样本"
              description="当前时间与环境下没有可查询的性能样本。请调整范围或检查 Web Vitals 采集；历史原始样本也可能已超过保留期，不能据此判断性能良好。"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {filters.route ? (
                    <button className="btn btn-sm" onClick={() => update({ route: undefined })}>
                      查看全部路由
                    </button>
                  ) : null}
                  <a
                    className="btn btn-sm btn-outline"
                    href={`/projects/${encodeURIComponent(project.id)}/onboarding`}
                  >
                    检查性能采集
                  </a>
                </div>
              }
            />
          </div>
        ) : null}
      </ConsolePageContent>
    </ConsolePage>
  );
}

function RoutesTable({
  filters,
  routes,
  onSelect,
  onMetricChange,
}: {
  filters: PerformanceFilters;
  routes: Awaited<ReturnType<typeof getPerformance>>["routes"];
  onSelect: (route: string) => void;
  onMetricChange: (metric: PerformanceMetricName) => void;
}) {
  return (
    <section className="performance-routes card card-border bg-base-100" aria-label="路由性能列表">
      <div className="card-body gap-1 border-b border-base-300 pb-4">
        <div className="performance-routes-title">
          <h2 className="card-title">路由性能</h2>
          <Select
            value={filters.metric}
            onValueChange={(value) => onMetricChange(value as PerformanceMetricName)}
          >
            <SelectTrigger aria-label="路由排序指标">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {performanceMetricNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-base-content/70">
          按 {filters.metric} {(filters.percentile ?? "p75").toUpperCase()} 从慢到快 · 最多 100 条 ·
          点击路由查看趋势与慢样本
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>路由</TableHead>
            <TableHead>{filters.metric} P75 判定</TableHead>
            <TableHead className="text-right">PV</TableHead>
            {performanceMetricNames.map((name) => (
              <TableHead key={name} className="text-right">
                {name} {(filters.percentile ?? "p75").toUpperCase()}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {routes.map((route) => {
            const selected = route[filters.metric.toLowerCase() as PerformanceMetricKey];
            const rating = performanceRating(
              selected?.sufficient ? selected.p75 : null,
              filters.metric,
            );
            return (
              <TableRow key={route.route}>
                <TableCell>
                  <button
                    type="button"
                    className="link link-hover max-w-72 text-left font-mono text-[13px] break-all whitespace-normal"
                    onClick={() => onSelect(route.route)}
                  >
                    {route.route}
                  </button>
                </TableCell>
                <TableCell>
                  <span
                    className={`badge badge-sm badge-soft ${selected?.sufficient ? ratingBadge[rating] : "badge-ghost"}`}
                  >
                    {selected?.sufficient ? ratingLabel(rating) : "样本不足"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {route.pageViews.toLocaleString()}
                </TableCell>
                {performanceMetricNames.map((name) => (
                  <MetricCell
                    key={name}
                    metric={route[name.toLowerCase() as PerformanceMetricKey]}
                    name={name}
                    percentile={filters.percentile ?? "p75"}
                    // The sorting metric carries the row's verdict colour.
                    tone={
                      name === filters.metric && selected?.sufficient
                        ? ratingText[rating]
                        : undefined
                    }
                  />
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
const ratingText: Record<PerformanceRating, string | undefined> = {
  good: undefined,
  "needs-improvement": "text-warning",
  poor: "text-error",
  unknown: undefined,
};

function MetricCell({
  metric,
  name,
  percentile,
  tone,
}: {
  metric: Awaited<ReturnType<typeof getPerformance>>["routes"][number]["lcp"] | undefined;
  name: string;
  percentile: PerformancePercentile;
  tone?: string;
}) {
  return (
    <TableCell className="text-right tabular-nums">
      <strong className={tone}>
        {formatPerformanceMetric(metric?.[percentile] ?? null, name)}
      </strong>
      <small className="block text-base-content/70">{metric?.samples ?? 0} 样本</small>
    </TableCell>
  );
}
function PerformanceSkeleton({ compact = false }: { compact?: boolean }) {
  const content = (
    <div className={compact ? "grid gap-4" : "performance-page"} aria-label="正在加载性能数据">
      <Skeleton className="h-24" />
      <Skeleton className="h-72" />
    </div>
  );
  return compact ? content : <ConsolePage width="fluid">{content}</ConsolePage>;
}

function subscribeLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("openrum:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("openrum:urlchange", callback);
  };
}

function formatRange(from: Date, to: Date) {
  const format = (value: Date) =>
    value.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${format(from)} – ${format(to)}`;
}
