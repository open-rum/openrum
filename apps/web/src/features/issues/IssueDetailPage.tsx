import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  EyeOffIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getEvent,
  getIssueDetail,
  getIssueEvents,
  parseIssueFilters,
  updateIssue,
  type IssueDetailResponse,
  type IssueStatus,
} from "@/lib/api/issues";
import { listMembers, listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { EventContext } from "./EventContext";
import { StackTrace } from "./StackTrace";

export function IssueDetailPage() {
  const { projectId, fingerprint } = useParams({ strict: false }) as {
    projectId?: string;
    fingerprint?: string;
  };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);
  if (!projectId || !fingerprint)
    return <IssueDetailError title="链接无效" description="项目或问题指纹缺失。" />;
  if (organizations.isLoading || projects.isLoading) return <IssueDetailSkeleton />;
  if (!project)
    return (
      <IssueDetailError title="项目不可用" description="项目不存在，或当前账号没有访问权限。" />
    );
  return (
    <ProjectIssueDetail
      project={project}
      organizationId={organization!.id}
      fingerprint={fingerprint}
    />
  );
}

function ProjectIssueDetail({
  project,
  organizationId,
  fingerprint,
}: {
  project: Project;
  organizationId: string;
  fingerprint: string;
}) {
  const queryClient = useQueryClient();
  const filters = useMemo(
    () => parseIssueFilters(project.id, new URLSearchParams(window.location.search)),
    [project.id],
  );
  const detailKey = [
    "issue",
    project.id,
    fingerprint,
    filters.from.toISOString(),
    filters.to.toISOString(),
    filters.environment,
    filters.release,
    filters.browser,
    filters.deviceType,
    filters.country,
  ] as const;
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => getIssueDetail(filters, fingerprint, signal),
  });
  const [eventCursor, setEventCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const samples = useQuery({
    queryKey: [
      "issue-events",
      project.id,
      fingerprint,
      filters.from.toISOString(),
      filters.to.toISOString(),
      eventCursor,
    ],
    queryFn: ({ signal }) => getIssueEvents(filters, fingerprint, eventCursor, signal),
  });
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const eventId = selectedEventId ?? samples.data?.events[0]?.eventId;
  const event = useQuery({
    queryKey: ["event", eventId],
    queryFn: ({ signal }) => getEvent(eventId!, signal),
    enabled: Boolean(eventId),
  });
  const members = useQuery({
    queryKey: ["members", organizationId],
    queryFn: () => listMembers(organizationId),
    enabled: project.role !== "viewer",
  });
  const mutation = useMutation({
    mutationFn: (patch: { status?: IssueStatus; assigneeUserId?: string }) =>
      updateIssue(filters, fingerprint, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<IssueDetailResponse>(detailKey);
      queryClient.setQueryData<IssueDetailResponse>(detailKey, (current) =>
        current
          ? {
              ...current,
              issue: {
                ...current.issue,
                ...(patch.status ? { status: patch.status } : {}),
                ...(patch.assigneeUserId !== undefined
                  ? { assigneeUserId: patch.assigneeUserId || null }
                  : {}),
              },
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => queryClient.setQueryData(detailKey, context?.previous),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["issues", project.id] }),
  });
  const canChange = project.role !== "viewer";

  if (detail.isLoading) return <IssueDetailSkeleton />;
  if (detail.error || !detail.data)
    return (
      <IssueDetailError
        title="无法加载问题详情"
        description="筛选条件已保留，请检查查询服务后重试。"
        onRetry={() => void detail.refetch()}
      />
    );
  const issue = detail.data.issue;
  return (
    <div className="issue-detail-page">
      <a className="issue-back-link" href={`/issues?${window.location.search.slice(1)}`}>
        <ArrowLeftIcon />
        返回问题列表
      </a>
      <header className="issue-detail-header">
        <div className="issue-detail-header__identity">
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> 问题详情
          </div>
          <div className="issue-title-row">
            <IssueStatusBadge status={issue.status} />
            <h1>{issue.title}</h1>
          </div>
          <code>
            {issue.errorType} · {issue.fingerprint}
          </code>
        </div>
        <div className="issue-actions">
          <Button
            variant="outline"
            size="icon"
            aria-label="复制问题链接"
            onClick={() => void navigator.clipboard.writeText(window.location.href)}
          >
            <ClipboardIcon />
          </Button>
          {issue.status === "unresolved" ? (
            <>
              <Button
                variant="outline"
                disabled={!canChange || mutation.isPending}
                onClick={() => mutation.mutate({ status: "ignored" })}
              >
                <EyeOffIcon />
                忽略
              </Button>
              <Button
                disabled={!canChange || mutation.isPending}
                onClick={() => mutation.mutate({ status: "resolved" })}
              >
                <CheckIcon />
                标记解决
              </Button>
            </>
          ) : (
            <Button
              disabled={!canChange || mutation.isPending}
              onClick={() => mutation.mutate({ status: "unresolved" })}
            >
              <RotateCcwIcon />
              重新打开
            </Button>
          )}
        </div>
      </header>
      {mutation.error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>更新失败，已恢复原状态</AlertTitle>
          <AlertDescription>请确认权限与服务状态后重试。</AlertDescription>
        </Alert>
      ) : null}
      <section className="issue-impact-grid" aria-label="问题影响">
        <ImpactMetric label="事件" value={issue.events} />
        <ImpactMetric label="用户" value={issue.users} />
        <ImpactMetric label="会话" value={issue.sessions} />
        <Card size="sm">
          <CardHeader>
            <CardDescription>负责人</CardDescription>
          </CardHeader>
          <CardContent>
            {canChange ? (
              <Select
                value={issue.assigneeUserId ?? "none"}
                onValueChange={(value) =>
                  mutation.mutate({ assigneeUserId: value === "none" ? "" : value })
                }
              >
                <SelectTrigger aria-label="负责人">
                  <SelectValue placeholder="未分配" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">未分配</SelectItem>
                    {members.data?.members.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.displayName || member.email}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <strong>{issue.assigneeUserId ? "已分配" : "未分配"}</strong>
            )}
          </CardContent>
        </Card>
      </section>
      <div className="issue-detail-grid">
        <section className="issue-main-column">
          <IssueTrend trend={detail.data.trend} />
          {event.isLoading ? <Skeleton className="h-96" /> : null}
          {event.error ? (
            <IssueDetailError
              title="事件上下文暂不可用"
              description="Issue 聚合数据仍然可用；可切换其他样本或稍后重试。"
              onRetry={() => void event.refetch()}
              compact
            />
          ) : null}
          {event.data ? (
            <>
              <StackTrace event={event.data} />
              <EventContext event={event.data} />
            </>
          ) : null}
        </section>
        <aside className="issue-side-column">
          <SamplesPanel
            loading={samples.isLoading}
            events={samples.data?.events ?? []}
            selected={eventId}
            onSelect={setSelectedEventId}
            hasPrevious={cursorHistory.length > 0}
            hasNext={Boolean(samples.data?.nextCursor)}
            onPrevious={() => {
              const history = [...cursorHistory];
              const previous = history.pop();
              setCursorHistory(history);
              setEventCursor(previous || undefined);
              setSelectedEventId(undefined);
            }}
            onNext={() => {
              if (!samples.data?.nextCursor) return;
              setCursorHistory((current) => [...current, eventCursor ?? ""]);
              setEventCursor(samples.data.nextCursor);
              setSelectedEventId(undefined);
            }}
          />
          <FacetsPanel facets={detail.data.facets} />
        </aside>
      </div>
    </div>
  );
}

function ImpactMetric({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value.toLocaleString()}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge
      variant={
        status === "unresolved" ? "destructive" : status === "resolved" ? "secondary" : "outline"
      }
    >
      {status === "unresolved" ? "待处理" : status === "resolved" ? "已解决" : "已忽略"}
    </Badge>
  );
}

function IssueTrend({ trend }: { trend: IssueDetailResponse["trend"] }) {
  const maximum = Math.max(1, ...trend.map((point) => point.events));
  return (
    <section className="issue-panel issue-trend" aria-labelledby="issue-trend-title">
      <div className="issue-panel__header">
        <div>
          <h2 id="issue-trend-title">发生趋势</h2>
          <p>当前筛选范围内的错误事件与受影响用户。</p>
        </div>
      </div>
      {trend.length ? (
        <div className="issue-trend__chart" role="img" aria-label="错误事件趋势">
          {trend.map((point) => (
            <div
              key={point.bucket}
              title={`${new Date(point.bucket).toLocaleString("zh-CN")} · ${point.events} 个事件`}
            >
              <i style={{ height: `${Math.max(4, (point.events / maximum) * 100)}%` }} />
              <span>
                {new Date(point.bucket).toLocaleDateString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="issue-empty-copy">这个时间范围内没有趋势数据。</p>
      )}
    </section>
  );
}

function SamplesPanel({
  loading,
  events,
  selected,
  onSelect,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  loading: boolean;
  events: Awaited<ReturnType<typeof getIssueEvents>>["events"];
  selected?: string;
  onSelect: (id: string) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <section className="issue-panel issue-samples" aria-labelledby="samples-title">
      <div className="issue-panel__header">
        <div>
          <h2 id="samples-title">事件样本</h2>
          <p>选择一次真实发生查看线索。</p>
        </div>
        {loading ? <RefreshCwIcon className="animate-spin" /> : null}
      </div>
      <div className="sample-list">
        {events.map((item) => (
          <button
            type="button"
            key={item.eventId}
            className={selected === item.eventId ? "is-active" : undefined}
            onClick={() => onSelect(item.eventId)}
          >
            <span>
              <strong>{item.errorMessage}</strong>
              <small>{item.route || item.pageUrl}</small>
            </span>
            <time dateTime={item.timestamp}>
              {new Date(item.timestamp).toLocaleString("zh-CN")}
            </time>
          </button>
        ))}
        {!loading && !events.length ? <p className="issue-empty-copy">没有可用事件样本。</p> : null}
      </div>
      <footer>
        <Button size="sm" variant="outline" disabled={!hasPrevious} onClick={onPrevious}>
          <ChevronLeftIcon />
          上一页
        </Button>
        <Button size="sm" variant="outline" disabled={!hasNext} onClick={onNext}>
          下一页
          <ChevronRightIcon />
        </Button>
      </footer>
    </section>
  );
}

function FacetsPanel({ facets }: { facets: IssueDetailResponse["facets"] }) {
  const groups = [
    ["环境", facets.environments],
    ["版本", facets.releases],
    ["浏览器", facets.browsers],
    ["设备", facets.deviceTypes],
    ["国家", facets.countries],
  ] as const;
  return (
    <section className="issue-panel issue-facets" aria-labelledby="facets-title">
      <div className="issue-panel__header">
        <div>
          <h2 id="facets-title">影响分布</h2>
          <p>按用户环境快速判断范围。</p>
        </div>
      </div>
      {groups.map(([label, values]) =>
        values.length ? (
          <div key={label}>
            <h3>{label}</h3>
            {values.slice(0, 4).map((item) => (
              <p key={item.value}>
                <span>{item.value || "未知"}</span>
                <strong>{item.events.toLocaleString()}</strong>
              </p>
            ))}
          </div>
        ) : null,
      )}
    </section>
  );
}

function IssueDetailSkeleton() {
  return (
    <div className="issue-detail-page" aria-label="正在加载问题详情">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="h-28" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-24" key={index} />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

function IssueDetailError({
  title,
  description,
  onRetry,
  compact = false,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <Alert variant="destructive" className={compact ? "my-0" : "my-8"}>
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {description}
        {onRetry ? (
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
