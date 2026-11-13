import { useMemo, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowDownIcon, NetworkIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
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
  apiFailureLevel,
  apiFailureRate,
  formatAPIFailureRate,
  defaultAPIFilters,
  formatAPIDuration,
  getAPIs,
  minimumAPISamples,
  sampledNote,
  serializeAPIFilters,
  type APIFilters,
  type APISort,
} from "@/lib/api/apis";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { ApiDetail, MethodBadge } from "./ApiDetail";
import { searchErrorFrom } from "@/lib/api/search";
import { ApiFilterBar } from "./ApiFilters";
import { ApiOverview } from "./ApiOverview";
import { MockDataNotice } from "@/components/dev/MockDataNotice";
import { MockDataContext } from "@/components/dev/mockData";
import { mockAPIs } from "./mockApis";

export function ApisPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
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
  // Preview data lives in this page's state only: it is gone on reload (development builds).
  const [mock, setMock] = useState(false);
  const query = useQuery({
    queryKey: [
      mock ? "apis-mock" : "apis",
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
      filters.q,
      filters.sort,
    ],
    queryFn: ({ signal }) => (mock ? Promise.resolve(mockAPIs(filters)) : getAPIs(filters, signal)),
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
  // Every column sorts largest first, as the sort menu beside the search does; the two stay in
  // step because both write `sort`.
  const sortableHead = (sort: APISort, label: string, title?: string) => (
    <TableHead
      className="apis-number"
      aria-sort={filters.sort === sort ? "descending" : undefined}
      title={title}
    >
      <button
        type="button"
        className="apis-sort-button"
        data-active={filters.sort === sort || undefined}
        onClick={() => update({ sort, method: undefined, url: undefined })}
      >
        {label}
        <ArrowDownIcon aria-hidden="true" />
      </button>
    </TableHead>
  );
  return (
    <MockDataContext.Provider value={mock}>
      <ConsolePage width="fluid">
        <ConsolePageHeader
          title="API 监控"
          description="按标准化 endpoint 比较请求量、失败分类与延迟分位。"
        />
        <MockDataNotice enabled={mock} onChange={setMock} />
        <ConsoleFilterBar
          primary={
            <ApiFilterBar
              filters={filters}
              facets={query.data?.facets}
              error={searchErrorFrom(query.error)}
              onChange={(patch) => update({ ...patch, method: undefined, url: undefined })}
            />
          }
        />
        <ConsolePageContent className="grid gap-6">
          {query.isLoading ? <APISkeleton compact /> : null}
          {query.data ? (
            <ApiOverview
              summary={query.data.summary}
              previous={query.data.previous}
              trend={query.data.trend}
              range={{
                from: query.data.from,
                to: query.data.to,
                interval: query.data.interval,
              }}
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
                    {sortableHead("requests", "请求量")}
                    {sortableHead("failures", "失败")}
                    {sortableHead("failureRate", "失败率", "5xx 与网络错误占比，不含 4xx")}
                    <TableHead className="apis-number">P50</TableHead>
                    <TableHead className="apis-number">P75</TableHead>
                    {sortableHead("p95", "P95")}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.endpoints.map((endpoint) => (
                    <TableRow
                      key={`${endpoint.method}:${endpoint.url}`}
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => update({ method: endpoint.method, url: endpoint.url })}
                      aria-label={`查看 ${endpoint.method} ${endpoint.url} 的详情`}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        update({ method: endpoint.method, url: endpoint.url });
                      }}
                    >
                      <TableCell>
                        <MethodBadge method={endpoint.method} />
                      </TableCell>
                      <TableCell>
                        <code>{endpoint.url}</code>
                      </TableCell>
                      <TableCell className="apis-number">
                        {Math.round(endpoint.estimated).toLocaleString()}
                        {sampledNote(endpoint) ? <small>{sampledNote(endpoint)}</small> : null}
                      </TableCell>
                      <TableCell className="apis-number">
                        {endpoint.failures.toLocaleString()}
                        {endpoint.failures ? (
                          <small>
                            {endpoint.serverErrors} 5xx · {endpoint.networkErrors} 网络
                          </small>
                        ) : null}
                      </TableCell>
                      <TableCell className="apis-number">
                        <span data-level={apiFailureLevel(apiFailureRate(endpoint))}>
                          {formatAPIFailureRate(endpoint)}
                        </span>
                        {endpoint.clientErrors ? (
                          <small>另有 {endpoint.clientErrors.toLocaleString()} 次 4xx</small>
                        ) : null}
                      </TableCell>
                      <TableCell className="apis-number">
                        {formatAPIDuration(endpoint.p50)}
                      </TableCell>
                      <TableCell className="apis-number">
                        {formatAPIDuration(endpoint.p75)}
                      </TableCell>
                      <TableCell className="apis-number font-semibold">
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
                  {query.data.summary.endpoints.toLocaleString()} 个。缩小时间范围或按
                  Route、环境筛选 可以看到其余 endpoint。
                </p>
              ) : null}
            </section>
          ) : null}
          {query.data && !query.data.endpoints.length ? (
            <div className="card card-border bg-base-100">
              <EmptyState
                icon={NetworkIcon}
                title="当前范围没有 API 请求"
                description="当前筛选下没有请求样本，不能据此判断 API 健康。请调整时间与环境；尚未采集时检查 SDK 的 fetch/XHR 配置。"
              />
              <div className="card-actions justify-center px-6 pb-6">
                {filters.q ? (
                  <Button
                    variant="outline"
                    onClick={() => update({ q: undefined, method: undefined, url: undefined })}
                  >
                    清除搜索条件
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link to="/projects/$projectId/onboarding" params={{ projectId: project.id }}>
                    检查项目接入
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
          {query.data?.detail ? (
            <ApiDetail
              detail={query.data.detail}
              filters={filters}
              range={{
                from: query.data.from,
                to: query.data.to,
                interval: query.data.interval,
              }}
              projectId={project.id}
              onClose={() => update({ method: undefined, url: undefined })}
            />
          ) : null}
        </ConsolePageContent>
      </ConsolePage>
    </MockDataContext.Provider>
  );
}
function APISkeleton({ compact = false }: { compact?: boolean }) {
  const content = (
    <div className={compact ? "grid gap-4" : "apis-page"} aria-label="正在加载 API 数据">
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
