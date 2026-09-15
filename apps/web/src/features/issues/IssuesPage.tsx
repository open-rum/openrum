import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BugIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { AnalysisFilterSidebar } from "@/components/layout/AnalysisFilterSidebar";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getIssues, type IssueFilters } from "@/lib/api/issues";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { IssueTable } from "./IssueTable";
import { useIssueFilters } from "./useIssueFilters";
import "./issues.css";

export function IssuesPage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <IssuesLoading />;
  if (organizations.error || projects.error)
    return (
      <ConsolePage width="fluid">
        <AsyncError
          error={organizations.error ?? projects.error}
          title="无法加载项目"
          remediation="请检查连接后重试，当前项目链接已保留。"
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
  if (!project && projectId)
    return (
      <ConsolePage width="fluid">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>项目不可用</EmptyTitle>
            <EmptyDescription>
              项目不存在或当前账号没有权限，请从项目列表重新选择。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ConsolePage>
    );
  if (!project) return <NoProjectIssues />;
  return <ProjectIssues key={project.id} project={project} />;
}

function ProjectIssues({ project }: { project: Project }) {
  const { filters, update } = useIssueFilters(project.id);
  const scope = JSON.stringify({ ...filters, cursor: undefined, search: undefined });
  const [pagination, setPagination] = useState<{
    scope: string;
    previous: Record<string, string | undefined>;
  }>({ scope, previous: {} });
  const previous = pagination.scope === scope ? pagination.previous : {};
  const query = useQuery({
    queryKey: [
      "issues",
      project.id,
      filters.from.toISOString(),
      filters.to.toISOString(),
      filters.environment,
      filters.release,
      filters.browser,
      filters.deviceType,
      filters.country,
      filters.route,
      filters.status,
      filters.sort,
      filters.cursor,
    ],
    queryFn: ({ signal }) => getIssues(filters, signal),
  });
  const search = filters.search?.trim().toLocaleLowerCase() ?? "";
  const issues = query.data?.issues ?? [];
  const visible = search
    ? issues.filter((issue) =>
        `${issue.title} ${issue.errorType} ${issue.fingerprint}`
          .toLocaleLowerCase()
          .includes(search),
      )
    : issues;
  const hasFilters = Boolean(
    filters.status ||
    filters.release ||
    filters.browser ||
    filters.deviceType ||
    filters.country ||
    filters.route ||
    filters.search,
  );
  const clearFilters = () =>
    update({
      status: undefined,
      release: undefined,
      browser: undefined,
      deviceType: undefined,
      country: undefined,
      route: undefined,
      search: undefined,
      cursor: undefined,
    });
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="错误问题"
        description="先判断影响，再定位原因。相同异常聚合为一个问题，点击查看堆栈与事件现场。"
        actions={
          <Button
            type="button"
            variant="outline"
            aria-label="刷新问题"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {query.isFetching ? "刷新中…" : "刷新"}
          </Button>
        }
      />
      <ToggleGroup
        type="single"
        variant="outline"
        value={filters.status ?? "all"}
        aria-label="处理状态"
        onValueChange={(value) => {
          if (value)
            update({
              status: value === "all" ? undefined : (value as IssueFilters["status"]),
              cursor: undefined,
            });
        }}
        className="issue-status-switch"
      >
        <ToggleGroupItem value="all">全部问题</ToggleGroupItem>
        <ToggleGroupItem value="unresolved">待处理</ToggleGroupItem>
        <ToggleGroupItem value="resolved">已解决</ToggleGroupItem>
        <ToggleGroupItem value="ignored">已忽略</ToggleGroupItem>
      </ToggleGroup>
      <ConsoleFilterBar
        primary={
          <Input
            type="search"
            aria-label="搜索本页问题"
            placeholder="搜索本页标题、类型或指纹…"
            maxLength={200}
            value={filters.search ?? ""}
            onChange={(event) => update({ search: event.target.value || undefined }, "replace")}
          />
        }
        secondary={<IssueFiltersBar filters={filters} update={update} />}
      />
      {hasFilters ? (
        <div className="issue-filter-summary">
          <span>
            当前筛选：
            {[
              filters.status &&
                { unresolved: "待处理", resolved: "已解决", ignored: "已忽略" }[filters.status],
              filters.release,
              filters.browser,
              filters.deviceType,
              filters.country,
              filters.route,
              filters.search && `本页搜索「${filters.search}」`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        </div>
      ) : null}
      <ConsolePageContent className="grid gap-6">
        <AnalysisFilterSidebar
          fields={[
            {
              key: "country",
              label: "国家 / 地区",
              value: filters.country,
              options: (query.data?.facets.countries ?? []).map(({ value }) => ({
                value,
                label: countryLabel(value),
              })),
            },
            {
              key: "deviceType",
              label: "设备类型",
              value: filters.deviceType,
              options: (query.data?.facets.deviceTypes ?? []).map(({ value }) => ({
                value,
                label: deviceLabel(value),
              })),
            },
            {
              key: "route",
              label: "路由",
              value: filters.route,
              text: true,
              maxLength: 512,
              options: [],
              description: "精确匹配 SDK 上报的路由。",
            },
            {
              key: "browser",
              label: "浏览器",
              value: filters.browser,
              options: query.data?.facets.browsers ?? [],
            },
            {
              key: "release",
              label: "版本",
              value: filters.release,
              text: true,
              options: query.data?.facets.releases ?? [],
            },
          ]}
          onApply={(values) => update({ ...values, cursor: undefined })}
        >
          {query.data ? (
            <section className="issue-list-summary" aria-label="本页问题概览">
              <div>
                <span>本页问题</span>
                <strong>{issues.length.toLocaleString()}</strong>
                <small>
                  {query.data.nextCursor ? "还有更多问题，可继续翻页" : "当前查询的最后一页"}
                </small>
              </div>
              <div>
                <span>本页待处理</span>
                <strong>
                  {issues.filter((issue) => issue.status === "unresolved").length.toLocaleString()}
                </strong>
                <small>按影响用户排序，优先排查影响较大的问题</small>
              </div>
              <div>
                <span>本页错误事件</span>
                <strong>
                  {issues.reduce((total, issue) => total + issue.events, 0).toLocaleString()}
                </strong>
                <small>所选时间与环境内，本页各问题的事件合计</small>
              </div>
            </section>
          ) : null}
          {query.isLoading ? <IssueTableSkeleton /> : null}
          {query.error ? (
            <AsyncError
              error={query.error}
              title="无法加载问题列表"
              remediation="筛选条件已保留；检查 API 与 ClickHouse 后重新加载。"
              onRetry={() => void query.refetch()}
            />
          ) : null}
          {query.data && (issues.length > 0 || filters.cursor || query.data.nextCursor) ? (
            <section className="issues-page__table" aria-label="错误问题列表">
              <div className="issue-list-heading">
                <h2>问题列表</h2>
                <span>搜索仅匹配本页 · 用户与会话在每个问题内去重</span>
              </div>
              {visible.length ? (
                <IssueTable issues={visible} filters={filters} />
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      {search ? "本页没有匹配的搜索结果" : "本页没有匹配状态的问题"}
                    </EmptyTitle>
                    <EmptyDescription>可以继续翻页，或调整筛选条件。</EmptyDescription>
                  </EmptyHeader>
                  {search ? (
                    <EmptyContent>
                      <Button
                        variant="outline"
                        onClick={() => update({ search: undefined }, "replace")}
                      >
                        清除搜索
                      </Button>
                    </EmptyContent>
                  ) : null}
                </Empty>
              )}
              <footer className="issues-page__pagination">
                <span aria-live="polite">
                  {search
                    ? `匹配 ${visible.length} / ${issues.length} 个问题`
                    : `本页 ${issues.length} 个问题`}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={!filters.cursor || query.isFetching}
                    onClick={() =>
                      update({ cursor: filters.cursor ? previous[filters.cursor] : undefined })
                    }
                  >
                    <ChevronLeftIcon data-icon="inline-start" />
                    {filters.cursor && !(filters.cursor in previous) ? "返回首页" : "上一页"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!query.data.nextCursor || query.isFetching}
                    onClick={() => {
                      const next = query.data?.nextCursor;
                      if (!next) return;
                      setPagination({ scope, previous: { ...previous, [next]: filters.cursor } });
                      update({ cursor: next });
                    }}
                  >
                    下一页
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              </footer>
            </section>
          ) : null}
          {query.data && !issues.length && !filters.cursor && !query.data.nextCursor ? (
            <Empty className="min-h-80 border border-border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BugIcon />
                </EmptyMedia>
                <EmptyTitle>当前范围没有匹配的问题</EmptyTitle>
                <EmptyDescription>
                  尝试扩大时间范围或清除状态、浏览器、设备与国家筛选。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={clearFilters}>
                  清除筛选
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
        </AnalysisFilterSidebar>
      </ConsolePageContent>
    </ConsolePage>
  );
}

function IssueFiltersBar({
  filters,
  update,
}: {
  filters: IssueFilters;
  update: (patch: Partial<Omit<IssueFilters, "projectId">>, mode?: "push" | "replace") => void;
}) {
  return (
    <div className="issues-filters" aria-label="问题排序">
      <Select
        value={filters.sort}
        onValueChange={(value) =>
          update({ sort: value as IssueFilters["sort"], cursor: undefined })
        }
      >
        <SelectTrigger aria-label="排序方式">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="events">事件数排序</SelectItem>
            <SelectItem value="users">影响用户排序</SelectItem>
            <SelectItem value="last_seen">最近发生排序</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function IssuesLoading() {
  return (
    <ConsolePage width="fluid" aria-label="正在加载错误问题">
      <Skeleton className="h-24" />
      <Skeleton className="h-10" />
      <Skeleton className="h-96" />
    </ConsolePage>
  );
}
function IssueTableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="正在加载问题">
      <Skeleton className="h-10" />
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton className="h-14" key={index} />
      ))}
    </div>
  );
}
function NoProjectIssues() {
  return (
    <ConsolePage width="narrow">
      <Empty className="min-h-80 border border-border">
        <EmptyHeader>
          <EmptyTitle>还没有监控项目</EmptyTitle>
          <EmptyDescription>创建项目并收到首个错误事件后，问题聚合会显示在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ConsolePage>
  );
}
