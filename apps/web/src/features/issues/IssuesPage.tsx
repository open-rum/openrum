import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowDownUpIcon,
  BugIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { DaisyDropdown } from "@/components/daisy/DaisyDropdown";
import { cn } from "@/lib/utils";
import { getIssueOverview, getIssues, updateIssue } from "@/lib/api/issues";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import { listMembers, listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { searchErrorFrom } from "@/lib/api/search";
import { IssueFilterComposer } from "./IssueFilterComposer";
import { IssueBulkBar } from "./IssueBulkBar";
import { IssueTable } from "./IssueTable";
import { IssueOverview } from "./IssueOverview";
import { issueSorts } from "./issueSort";
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
        <EmptyCard
          title="项目不可用"
          description="项目不存在或当前账号没有权限，请从项目列表重新选择。"
        />
      </ConsolePage>
    );
  if (!project) return <NoProjectIssues />;
  return <ProjectIssues key={project.id} project={project} />;
}

function ProjectIssues({ project }: { project: Project }) {
  const { filters, update } = useIssueFilters(project.id, { foldIntoQuery: true });
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
      filters.q,
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
      filters.q,
    ],
    queryFn: ({ signal }) => getIssueOverview(filters, signal),
  });
  const issues = query.data?.issues ?? [];
  const canChange = project.role !== "viewer";
  // The owner column shows names and pictures; without the list it still shows who owns what.
  const members = useQuery({
    queryKey: ["members", project.organizationId],
    queryFn: () => listMembers(project.organizationId),
    retry: false,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const assign = useMutation({
    mutationFn: ({
      fingerprint,
      assigneeUserId,
    }: {
      fingerprint: string;
      assigneeUserId: string;
    }) => updateIssue(filters, fingerprint, { assigneeUserId }),
    onSuccess: (_state, { assigneeUserId }) => {
      toast.success(assigneeUserId ? "已分配负责人" : "已取消分配");
      void queryClient.invalidateQueries({ queryKey: ["issues", project.id] });
    },
    onError: () => toast.error("分配失败，请稍后重试"),
  });
  // A selection belongs to the page it was made on; any filter, sort or page change drops it.
  const selectionKey = `${scope}|${filters.cursor ?? ""}`;
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: selectionKey,
    ids: new Set(),
  });
  const selectedIds = selection.key === selectionKey ? selection.ids : new Set<string>();
  const selectedIssues = issues.filter((issue) => selectedIds.has(issue.fingerprint));
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="错误问题"
        description="相同异常聚合为一个问题，可查看影响范围、堆栈与事件现场。"
      />
      <ConsoleFilterBar
        primary={
          <>
            <IssueFilterComposer
              projectId={project.id}
              filters={filters}
              facets={query.data?.facets}
              errorTypes={overviewQuery.data?.errorTypes}
              error={searchErrorFrom(query.error) ?? searchErrorFrom(overviewQuery.error)}
              onChange={(patch) => update({ ...patch, cursor: undefined })}
            />
            <DaisyDropdown
              label="问题排序"
              triggerClassName="btn"
              menuClassName="w-64"
              trigger={
                <>
                  <ArrowDownUpIcon className="size-4" aria-hidden="true" />
                  {/* The trigger names the order; the hints belong to the menu. */}
                  {issueSorts.find((item) => item.value === filters.sort)?.label}
                  <ChevronDownIcon className="size-3 text-base-content/70" aria-hidden="true" />
                </>
              }
            >
              {(close) =>
                issueSorts.map((item) => (
                  <li key={item.value}>
                    <button
                      type="button"
                      className={cn(item.value === filters.sort && "menu-active")}
                      onClick={() => {
                        close();
                        update({ sort: item.value, cursor: undefined });
                      }}
                    >
                      <span className="flex grow flex-col items-start gap-0.5">
                        <strong className="font-medium">{item.label}</strong>
                        <small className="text-xs text-base-content/70">{item.hint}</small>
                      </span>
                      {item.value === filters.sort ? (
                        <CheckIcon className="size-4" aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                ))
              }
            </DaisyDropdown>
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
        {overviewQuery.data ? (
          <IssueOverview
            overview={overviewQuery.data}
            hasHistoricalIssues={issues.some((issue) => issue.events > 0)}
          />
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
          <section
            className="issues-page__table card card-border bg-base-100"
            aria-label="错误问题列表"
          >
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
                onOpen={(href) => void navigate({ href })}
                assignment={{
                  members: members.data?.members,
                  onAssign: canChange
                    ? (issue, assigneeUserId) =>
                        assign.mutate({ fingerprint: issue.fingerprint, assigneeUserId })
                    : undefined,
                }}
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
              <div className="flex min-h-48 flex-col items-center justify-center gap-1 p-6 text-center">
                <p className="font-medium">
                  {filters.q ? "没有匹配当前查询的问题" : "本页没有匹配状态的问题"}
                </p>
                <p className="text-sm text-base-content/70">可以继续翻页，或调整筛选条件。</p>
                {filters.q ? (
                  <button
                    type="button"
                    className="btn btn-sm mt-3"
                    onClick={() => update({ q: "" }, "replace")}
                  >
                    清除搜索
                  </button>
                ) : null}
              </div>
            )}
            <footer className="issues-page__pagination">
              <span aria-live="polite">{`本页 ${issues.length} 个问题`}</span>
              <div className="join">
                <button
                  type="button"
                  className="btn btn-sm join-item"
                  disabled={!filters.cursor || query.isFetching}
                  onClick={() =>
                    update({ cursor: filters.cursor ? previous[filters.cursor] : undefined })
                  }
                >
                  <ChevronLeftIcon className="size-4" aria-hidden="true" />
                  {filters.cursor && !(filters.cursor in previous) ? "返回首页" : "上一页"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm join-item"
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => {
                    const next = query.data?.nextCursor;
                    if (!next) return;
                    setPagination({ scope, previous: { ...previous, [next]: filters.cursor } });
                    update({ cursor: next });
                  }}
                >
                  下一页
                  <ChevronRightIcon className="size-4" aria-hidden="true" />
                </button>
              </div>
            </footer>
          </section>
        ) : null}
        {query.data && !issues.length && !filters.cursor && !query.data.nextCursor ? (
          <EmptyCard
            icon={<BugIcon className="size-8 opacity-40" aria-hidden="true" />}
            title="当前范围没有匹配的问题"
            description="尝试扩大时间范围或清除状态、浏览器、设备与国家筛选。"
          />
        ) : null}
      </ConsolePageContent>
    </ConsolePage>
  );
}

function IssuesLoading() {
  return (
    <ConsolePage width="fluid" aria-label="正在加载错误问题">
      <div className="skeleton h-24" />
      <div className="skeleton h-10" />
      <div className="skeleton h-96" />
    </ConsolePage>
  );
}
function IssueTableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="正在加载问题">
      <div className="skeleton h-10" />
      {Array.from({ length: 7 }, (_, index) => (
        <div className="skeleton h-14" key={index} />
      ))}
    </div>
  );
}
function IssueOverviewSkeleton() {
  return <div className="skeleton h-40" aria-label="正在加载错误概览" />;
}
function NoProjectIssues() {
  return (
    <ConsolePage width="narrow">
      <EmptyCard
        title="还没有监控项目"
        description="创建项目并收到首个错误事件后，问题聚合会显示在这里。"
      />
    </ConsolePage>
  );
}
function EmptyCard({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card card-border min-h-80 bg-base-100">
      <div className="card-body items-center justify-center text-center">
        {icon}
        <h2 className="card-title">{title}</h2>
        <p className="text-base-content/70">{description}</p>
      </div>
    </div>
  );
}
