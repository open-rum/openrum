import { useQuery } from "@tanstack/react-query";
import { BugIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
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
import { getIssues, type IssueFilters, type IssuesResponse } from "@/lib/api/issues";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { IssueTable } from "./IssueTable";
import { useIssueFilters } from "./useIssueFilters";

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
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project) return <NoProjectIssues />;
  return <ProjectIssues project={project} />;
}

function ProjectIssues({ project }: { project: Project }) {
  const { filters, update } = useIssueFilters(project.id);
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
      filters.status,
      filters.sort,
      filters.cursor,
    ],
    queryFn: ({ signal }) => getIssues(filters, signal),
  });
  return (
    <div className="issues-page">
      <header className="issues-page__header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> 异常栈
          </div>
          <h1>错误问题</h1>
          <p>按稳定指纹聚合异常，定位影响范围并进入具体事件。</p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="刷新问题"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      <IssueFiltersBar filters={filters} data={query.data} update={update} />
      {query.isLoading ? <IssueTableSkeleton /> : null}
      {query.error ? (
        <AsyncError
          error={query.error}
          title="无法加载问题列表"
          remediation="筛选条件已保留；检查 API 与 ClickHouse 后重新加载。"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data?.issues.length ? (
        <section className="issues-page__table" aria-label="错误问题列表">
          <IssueTable issues={query.data.issues} filters={filters} />
          <footer className="issues-page__pagination">
            <span>本页 {query.data.issues.length} 个问题</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!filters.cursor}
                onClick={() => window.history.back()}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={!query.data.nextCursor}
                onClick={() => update({ cursor: query.data?.nextCursor })}
              >
                下一页
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </footer>
        </section>
      ) : null}
      {query.data && query.data.issues.length === 0 ? (
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
            <Button
              variant="outline"
              onClick={() =>
                update({
                  environment: undefined,
                  release: undefined,
                  browser: undefined,
                  deviceType: undefined,
                  country: undefined,
                  status: undefined,
                  cursor: undefined,
                })
              }
            >
              清除筛选
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </div>
  );
}

function IssueFiltersBar({
  filters,
  data,
  update,
}: {
  filters: IssueFilters;
  data?: IssuesResponse;
  update: (patch: Partial<Omit<IssueFilters, "projectId">>, mode?: "push" | "replace") => void;
}) {
  const selects = [
    { key: "release", label: "全部版本", options: data?.facets.releases ?? [] },
    { key: "browser", label: "全部浏览器", options: data?.facets.browsers ?? [] },
    { key: "deviceType", label: "全部设备", options: data?.facets.deviceTypes ?? [] },
    { key: "country", label: "全部国家", options: data?.facets.countries ?? [] },
  ] as const;
  return (
    <div className="issues-filters" aria-label="问题筛选">
      <Select
        value={filters.status ?? "all"}
        onValueChange={(value) =>
          update({
            status: value === "all" ? undefined : (value as IssueFilters["status"]),
            cursor: undefined,
          })
        }
      >
        <SelectTrigger aria-label="处理状态">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="unresolved">待处理</SelectItem>
            <SelectItem value="resolved">已解决</SelectItem>
            <SelectItem value="ignored">已忽略</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {selects.map(({ key, label, options }) => (
        <Select
          key={key}
          value={filters[key] ?? "all"}
          onValueChange={(value) =>
            update({ [key]: value === "all" ? undefined : value, cursor: undefined }, "replace")
          }
        >
          <SelectTrigger aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{label}</SelectItem>
              {options
                .filter((option) => option.value)
                .map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.value} · {option.events.toLocaleString()}
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ))}
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
    <div className="issues-page">
      <Skeleton className="h-24" />
      <Skeleton className="h-10" />
      <Skeleton className="h-96" />
    </div>
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
    <Empty className="mx-auto mt-20 max-w-xl border border-border">
      <EmptyHeader>
        <EmptyTitle>还没有监控项目</EmptyTitle>
        <EmptyDescription>创建项目并收到首个错误事件后，问题聚合会显示在这里。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
