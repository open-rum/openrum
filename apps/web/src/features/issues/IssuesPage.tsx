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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { getIssueOverview, getIssues, type IssueFilters } from "@/lib/api/issues";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { IssueFilterComposer } from "./IssueFilterComposer";
import { IssueBulkBar } from "./IssueBulkBar";
import { IssueTable } from "./IssueTable";
import { IssueOverview } from "./IssueOverview";
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
      filters.title,
      filters.errorType,
      filters.fingerprint,
      filters.userId,
      filters.release,
      filters.browser,
      filters.deviceType,
      filters.country,
      filters.route,
      filters.status,
      filters.assignee,
      filters.newOnly,
      filters.sort,
      filters.cursor,
    ],
    queryFn: ({ signal }) => getIssues(filters, signal),
  });
  const overviewQuery = useQuery({
    queryKey: [
      "issues-overview",
      project.id,
      TIME_SERIES_MAX_POINTS,
      filters.from.toISOString(),
      filters.to.toISOString(),
      filters.environment,
      filters.title,
      filters.errorType,
      filters.fingerprint,
      filters.userId,
      filters.release,
      filters.browser,
      filters.deviceType,
      filters.country,
      filters.route,
    ],
    queryFn: ({ signal }) => getIssueOverview(filters, signal),
  });
  const issues = query.data?.issues ?? [];
  const canChange = project.role !== "viewer";
  // A selection belongs to the page it was made on; any filter, sort or page change drops it.
  const selectionKey = `${scope}|${filters.cursor ?? ""}`;
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: selectionKey,
    ids: new Set(),
  });
  const selectedIds = selection.key === selectionKey ? selection.ids : new Set<string>();
  const selectedIssues = issues.filter((issue) => selectedIds.has(issue.fingerprint));
  const hasFilters = Boolean(
    filters.status ||
    filters.assignee ||
    filters.newOnly ||
    filters.title ||
    filters.errorType ||
    filters.fingerprint ||
    filters.userId ||
    filters.release ||
    filters.browser ||
    filters.deviceType ||
    filters.country ||
    filters.route ||
    filters.sort !== "events",
  );
  const clearFilters = () =>
    update({
      status: undefined,
      assignee: undefined,
      newOnly: undefined,
      title: undefined,
      errorType: undefined,
      fingerprint: undefined,
      userId: undefined,
      release: undefined,
      browser: undefined,
      deviceType: undefined,
      country: undefined,
      route: undefined,
      sort: "events",
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
      <ConsoleFilterBar
        primary={
          <>
            <Select
              value={filters.status ?? "all"}
              onValueChange={(value) =>
                update({
                  status: value === "all" ? undefined : (value as IssueFilters["status"]),
                  cursor: undefined,
                })
              }
            >
              <SelectTrigger aria-label="问题状态" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="unresolved">待处理</SelectItem>
                  <SelectItem value="regressed">已回归</SelectItem>
                  <SelectItem value="resolved">已解决</SelectItem>
                  <SelectItem value="ignored">已忽略</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="issue-quick-filters" role="group" aria-label="快捷筛选">
              <Toggle
                variant="outline"
                size="sm"
                pressed={Boolean(filters.newOnly)}
                onPressedChange={(on) => update({ newOnly: on || undefined, cursor: undefined })}
                title="首次发生在所选时间范围内的问题"
              >
                新问题
              </Toggle>
              <Toggle
                variant="outline"
                size="sm"
                pressed={filters.assignee === "none"}
                onPressedChange={(on) =>
                  update({ assignee: on ? "none" : undefined, cursor: undefined })
                }
              >
                未分配
              </Toggle>
              <Toggle
                variant="outline"
                size="sm"
                pressed={filters.assignee === "me"}
                onPressedChange={(on) =>
                  update({ assignee: on ? "me" : undefined, cursor: undefined })
                }
              >
                分配给我
              </Toggle>
            </div>
            <IssueFilterComposer
              filters={filters}
              facets={query.data?.facets}
              errorTypes={overviewQuery.data?.errorTypes}
              onChange={(patch) => update({ ...patch, cursor: undefined })}
            />
            {hasFilters ? (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                清除筛选
              </Button>
            ) : null}
          </>
        }
      />
      <ConsolePageContent className="grid gap-6">
        {overviewQuery.isLoading ? <IssueOverviewSkeleton /> : null}
        {overviewQuery.error ? (
          <AsyncError
            error={overviewQuery.error}
            title="无法加载错误概览"
            remediation="问题列表仍可使用；请稍后重新加载概览图表。"
            onRetry={() => void overviewQuery.refetch()}
          />
        ) : null}
        {overviewQuery.data ? <IssueOverview overview={overviewQuery.data} /> : null}
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
            <div
              className="issue-list-heading"
              data-selecting={selectedIssues.length > 0 || undefined}
            >
              {selectedIssues.length ? (
                <IssueBulkBar
                  project={project}
                  selected={selectedIssues}
                  onClear={() => setSelection({ key: selectionKey, ids: new Set() })}
                />
              ) : (
                <>
                  <h2>问题列表</h2>
                  <span>
                    「新」表示首次发生在所选范围内（最多回溯 30 天）· 用户在每个问题内去重
                  </span>
                </>
              )}
            </div>
            {issues.length ? (
              <IssueTable
                issues={issues}
                filters={filters}
                onSortChange={(sort) => update({ sort, cursor: undefined })}
                selection={
                  canChange
                    ? {
                        selected: selectedIds,
                        onChange: (ids) => setSelection({ key: selectionKey, ids }),
                      }
                    : undefined
                }
              />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {filters.title ? "没有匹配该错误标题的问题" : "本页没有匹配状态的问题"}
                  </EmptyTitle>
                  <EmptyDescription>可以继续翻页，或调整筛选条件。</EmptyDescription>
                </EmptyHeader>
                {filters.title ? (
                  <EmptyContent>
                    <Button
                      variant="outline"
                      onClick={() => update({ title: undefined }, "replace")}
                    >
                      清除搜索
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            )}
            <footer className="issues-page__pagination">
              <span aria-live="polite">{`本页 ${issues.length} 个问题`}</span>
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
          </Empty>
        ) : null}
      </ConsolePageContent>
    </ConsolePage>
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
function IssueOverviewSkeleton() {
  return <Skeleton className="h-40" aria-label="正在加载错误概览" />;
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
