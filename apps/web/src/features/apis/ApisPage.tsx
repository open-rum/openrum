import { useMemo, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { NetworkIcon, RefreshCwIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
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
  apiFailureRate,
  defaultAPIFilters,
  formatAPIDuration,
  getAPIs,
  minimumAPISamples,
  serializeAPIFilters,
  type APIFilters,
} from "@/lib/api/apis";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { ApiDetail, MethodBadge } from "./ApiDetail";
import { ApiFilterBar } from "./ApiFilters";
import { ApiOverview } from "./ApiOverview";

export function ApisPage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <APISkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={NetworkIcon}
        title="尚未接入项目"
        description="创建项目并接入 SDK 后，即可分析 API。"
      />
    );
  return <ProjectAPIs project={project} />;
}

function ProjectAPIs({ project }: { project: Project }) {
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const filters = useMemo(
    () => defaultAPIFilters(project.id, new URLSearchParams(search)),
    [project.id, search],
  );
  const query = useQuery({
    queryKey: [
      "apis",
      project.id,
      filters.from.toISOString(),
      filters.to.toISOString(),
      filters.environment,
      filters.release,
      filters.route,
      filters.methods.join(","),
      filters.method,
      filters.url,
      filters.search,
      filters.sort,
    ],
    queryFn: ({ signal }) => getAPIs(filters, signal),
    // Selecting an endpoint only adds `detail` to the response: the list,
    // summary, trend and facets are computed without the singular method and
    // url. Without this the changed key has no cache entry, so the page falls
    // back to its skeleton and rebuilds identical content before the drawer
    // can open. Holding the previous data keeps the page still underneath.
    placeholderData: keepPreviousData,
  });
  const update = (patch: Partial<APIFilters>) => {
    const parameters = serializeAPIFilters({ ...filters, ...patch });
    window.history.pushState({}, "", `${window.location.pathname}?${parameters}`);
    window.dispatchEvent(new Event("openrum:urlchange"));
  };
  return (
    <div className="apis-page">
      <header className="apis-header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> API
          </div>
          <h1>API 监控</h1>
          <p>按标准化 endpoint 比较请求量、失败分类与延迟分位。</p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label="刷新 API 数据"
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      <ApiFilterBar
        filters={filters}
        facets={query.data?.facets}
        onChange={(patch) => update({ ...patch, method: undefined, url: undefined })}
      />
      {query.isLoading ? <APISkeleton compact /> : null}
      {query.data ? (
        <ApiOverview
          summary={query.data.summary}
          previous={query.data.previous}
          trend={query.data.trend}
          endpoints={query.data.endpoints}
          onSelect={(endpoint) => update({ method: endpoint.method, url: endpoint.url })}
        />
      ) : null}
      {query.error ? (
        <AsyncError
          error={query.error}
          title="API 监控加载失败"
          remediation="当前筛选已保留；缩短范围或稍后重新加载。"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data?.endpoints.length ? (
        <section className="apis-table" aria-label="API endpoint 列表">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>方法</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>请求量（估算）</TableHead>
                <TableHead>失败</TableHead>
                <TableHead>失败率</TableHead>
                <TableHead>P50</TableHead>
                <TableHead>P75</TableHead>
                <TableHead>P95</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.endpoints.map((endpoint) => (
                <TableRow
                  key={`${endpoint.method}:${endpoint.url}`}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => update({ method: endpoint.method, url: endpoint.url })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      update({ method: endpoint.method, url: endpoint.url });
                  }}
                >
                  <TableCell>
                    <MethodBadge method={endpoint.method} />
                  </TableCell>
                  <TableCell>
                    <code>{endpoint.url}</code>
                  </TableCell>
                  <TableCell>
                    {Math.round(endpoint.estimated).toLocaleString()}
                    <small>{endpoint.requests.toLocaleString()} 个采样事件</small>
                  </TableCell>
                  <TableCell>
                    {endpoint.failures.toLocaleString()}
                    <small>
                      {endpoint.serverErrors} 5xx · {endpoint.networkErrors} 网络
                    </small>
                  </TableCell>
                  <TableCell>
                    <span data-failing={endpoint.failures > 0}>
                      {apiFailureRate(endpoint).toFixed(2)}%
                    </span>
                    <small>{endpoint.clientErrors} 次 4xx 未计入</small>
                  </TableCell>
                  <TableCell>{formatAPIDuration(endpoint.p50)}</TableCell>
                  <TableCell>{formatAPIDuration(endpoint.p75)}</TableCell>
                  <TableCell className="font-semibold">
                    {formatAPIDuration(endpoint.p95)}
                    {endpoint.sufficient ? null : (
                      <small
                        className="apis-insufficient"
                        title={`分位数样本少于 ${minimumAPISamples} 次请求，结果波动较大`}
                      >
                        样本不足
                      </small>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {query.data.truncated ? (
            <p className="apis-truncated">
              仅显示排名前 {query.data.endpoints.length.toLocaleString()} 个 endpoint，共{" "}
              {query.data.summary.endpoints.toLocaleString()} 个。缩小时间范围或按 Route、环境筛选
              可以看到其余 endpoint。
            </p>
          ) : null}
        </section>
      ) : null}
      {query.data && !query.data.endpoints.length ? (
        <div className="border border-border">
          <EmptyState
            icon={NetworkIcon}
            title="当前范围没有 API 请求"
            description="确认 fetch/XHR 自动采集已开启，且请求不是 OpenRUM 自身 endpoint。"
          />
        </div>
      ) : null}
      {query.data?.detail ? (
        <ApiDetail
          detail={query.data.detail}
          projectId={project.id}
          onClose={() => update({ method: undefined, url: undefined })}
        />
      ) : null}
    </div>
  );
}
function APISkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-4" : "apis-page"} aria-label="正在加载 API 数据">
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
