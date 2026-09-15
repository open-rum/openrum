import { useMemo, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ActivityIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { AnalysisFilterSidebar } from "@/components/layout/AnalysisFilterSidebar";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  performanceMetricNames,
  type PerformanceMetricKey,
  type PerformancePercentile,
  type PerformanceFilters,
  type PerformanceMetricName,
} from "@/lib/api/performance";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { RouteDetail } from "./RouteDetail";
import { PerformanceOverview } from "./PerformanceOverview";
import { performanceRating, ratingLabel } from "./score";
import "./performance.css";

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
  const facets = query.data?.facets;
  const fields = [
    {
      key: "country",
      label: "国家 / 地区",
      value: filters.country,
      options: (facets?.countries ?? []).map(({ value }) => ({
        value,
        label: countryLabel(value),
      })),
    },
    {
      key: "deviceType",
      label: "设备类型",
      value: filters.deviceType,
      options: (facets?.deviceTypes ?? []).map(({ value }) => ({
        value,
        label: deviceLabel(value),
      })),
    },
    {
      key: "route",
      label: "路由",
      value: filters.route,
      text: true,
      maxLength: 1024,
      options: facets?.routes ?? [],
      description: "精确匹配 SDK 上报的路由；可选择建议或输入完整路径。",
    },
    { key: "browser", label: "浏览器", value: filters.browser, options: facets?.browsers ?? [] },
    {
      key: "release",
      label: "版本",
      value: filters.release,
      text: true,
      maxLength: 128,
      options: facets?.releases ?? [],
    },
  ];
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader title="真实用户性能" />
      <ConsolePageContent className="grid gap-6">
        <AnalysisFilterSidebar fields={fields} onApply={update}>
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
              detail={query.data.detail}
              percentile={percentile}
              onBack={() => update({ route: undefined })}
              onPercentileChange={(percentile) => update({ percentile })}
              onMetricChange={(metric) => update({ metric })}
            />
          ) : null}
          {query.data && !query.data.detail && hasSamples ? (
            <>
              <PerformanceOverview
                summary={query.data.summary}
                trend={query.data.trend}
                percentile={percentile}
                onPercentileChange={(percentile) => update({ percentile })}
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
            <div className="border border-border">
              <EmptyState
                icon={ActivityIcon}
                title="当前范围没有性能样本"
                description="确认 SDK 已启用 Web Vitals，或扩大时间范围后重试。"
              />
            </div>
          ) : null}
        </AnalysisFilterSidebar>
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
    <section className="performance-routes" aria-label="Route 性能列表">
      <div className="performance-routes-heading">
        <div className="performance-routes-title">
          <h2>路由性能</h2>
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
        <p>
          按 {filters.metric} {(filters.percentile ?? "p75").toUpperCase()} 从慢到快 · 最多 100 条 ·
          点击路由查看趋势与慢样本
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Route</TableHead>
            <TableHead>{filters.metric} P75 判定</TableHead>
            <TableHead>PV</TableHead>
            {performanceMetricNames.map((name) => (
              <TableHead key={name}>
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
                  <Button
                    variant="link"
                    className="h-auto max-w-72 justify-start whitespace-normal break-all p-0 text-left"
                    onClick={() => onSelect(route.route)}
                  >
                    {route.route}
                  </Button>
                </TableCell>
                <TableCell>
                  <span className={`performance-table-rating performance-table-rating--${rating}`}>
                    {selected?.sufficient ? ratingLabel(rating) : "样本不足"}
                  </span>
                </TableCell>
                <TableCell>{route.pageViews.toLocaleString()}</TableCell>
                {performanceMetricNames.map((name) => (
                  <MetricCell
                    key={name}
                    metric={route[name.toLowerCase() as PerformanceMetricKey]}
                    name={name}
                    percentile={filters.percentile ?? "p75"}
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
function MetricCell({
  metric,
  name,
  percentile,
}: {
  metric: Awaited<ReturnType<typeof getPerformance>>["routes"][number]["lcp"] | undefined;
  name: string;
  percentile: PerformancePercentile;
}) {
  return (
    <TableCell>
      <strong>{formatPerformanceMetric(metric?.[percentile] ?? null, name)}</strong>
      <small className="block text-muted-foreground">{metric?.samples ?? 0} 样本</small>
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
