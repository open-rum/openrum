import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  RefreshCwIcon,
} from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type PerformanceFilters,
  type PerformanceMetricName,
} from "@/lib/api/performance";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { RouteDetail } from "./RouteDetail";
import { PerformanceOverview } from "./PerformanceOverview";
import { performanceRating, ratingLabel } from "./score";

export function PerformancePage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <PerformanceSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={ActivityIcon}
        title="尚未接入项目"
        description="创建项目并接入 SDK 后，即可分析真实用户性能。"
      />
    );
  return <ProjectPerformance project={project} />;
}

function ProjectPerformance({ project }: { project: Project }) {
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const filters = useMemo(
    () => defaultPerformanceFilters(project.id, new URLSearchParams(search)),
    [project.id, search],
  );
  const query = useQuery({
    queryKey: [
      "performance",
      project.id,
      filters.from.toISOString(),
      filters.to.toISOString(),
      filters.environment,
      filters.release,
      filters.route,
      filters.metric,
    ],
    queryFn: ({ signal }) => getPerformance(filters, signal),
  });
  const update = (patch: Partial<PerformanceFilters>) => {
    const parameters = serializePerformanceFilters({ ...filters, ...patch });
    window.history.pushState({}, "", `${window.location.pathname}?${parameters}`);
    window.dispatchEvent(new Event("openrum:urlchange"));
  };
  return (
    <div className="performance-page">
      <header className="performance-header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> 性能
          </div>
          <h1>真实用户性能</h1>
          <p>按 Route 比较 Core Web Vitals，识别普遍回归与慢样本。</p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label="刷新性能数据"
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      <div className="performance-toolbar" aria-label="性能指标">
        {(["LCP", "INP", "CLS"] as PerformanceMetricName[]).map((metric) => (
          <Button
            key={metric}
            size="sm"
            variant={filters.metric === metric ? "default" : "outline"}
            onClick={() => update({ metric })}
          >
            {metric}
          </Button>
        ))}
        <span>按 P75 评分 · 时间与环境沿用全局分析范围</span>
      </div>
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
        <RouteDetail detail={query.data.detail} onBack={() => update({ route: undefined })} />
      ) : null}
      {query.data && !query.data.detail && query.data.routes.length ? (
        <>
          <PerformanceOverview
            routes={query.data.routes}
            trend={query.data.trend}
            selectedMetric={filters.metric}
          />
          <RoutesTable
            filters={filters}
            routes={query.data.routes}
            onSelect={(route) => update({ route })}
          />
        </>
      ) : null}
      {query.data && !query.data.routes.length ? (
        <div className="border border-border">
          <EmptyState
            icon={ActivityIcon}
            title="当前范围没有性能样本"
            description="确认 SDK 已启用 Web Vitals，或扩大时间范围后重试。"
          />
        </div>
      ) : null}
    </div>
  );
}

function RoutesTable({
  filters,
  routes,
  onSelect,
}: {
  filters: PerformanceFilters;
  routes: Awaited<ReturnType<typeof getPerformance>>["routes"];
  onSelect: (route: string) => void;
}) {
  return (
    <section className="performance-routes" aria-label="Route 性能列表">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Route</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>PV</TableHead>
            <TableHead>LCP P75</TableHead>
            <TableHead>INP P75</TableHead>
            <TableHead>CLS P75</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {routes.map((route) => {
            const selected = route[filters.metric.toLowerCase() as "lcp" | "inp" | "cls"];
            const rating = performanceRating(selected.p75, filters.metric);
            const RatingIcon =
              rating === "good"
                ? CircleCheckIcon
                : rating === "needs-improvement"
                  ? CircleAlertIcon
                  : CircleXIcon;
            return (
              <TableRow
                key={route.route}
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => onSelect(route.route)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSelect(route.route);
                }}
              >
                <TableCell>
                  <strong>{route.route}</strong>
                  {!selected.sufficient ? (
                    <Badge className="ml-2" variant="outline">
                      数据不足
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className={`performance-table-rating performance-table-rating--${rating}`}>
                    <RatingIcon />
                    {ratingLabel(rating)}
                  </span>
                </TableCell>
                <TableCell>{route.pageViews.toLocaleString()}</TableCell>
                <MetricCell metric={route.lcp} name="LCP" />
                <MetricCell metric={route.inp} name="INP" />
                <MetricCell metric={route.cls} name="CLS" />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
function MetricCell({
  metric,
  name,
}: {
  metric: { p75: number | null; samples: number; sufficient: boolean };
  name: string;
}) {
  return (
    <TableCell>
      <strong>{formatPerformanceMetric(metric.p75, name)}</strong>
      <small className="block text-muted-foreground">{metric.samples} 样本</small>
    </TableCell>
  );
}
function PerformanceSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-4" : "performance-page"} aria-label="正在加载性能数据">
      <Skeleton className="h-24" />
      <Skeleton className="h-72" />
    </div>
  );
}

function subscribeLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("openrum:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("openrum:urlchange", callback);
  };
}
