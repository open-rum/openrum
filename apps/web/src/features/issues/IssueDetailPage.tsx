import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CopyIcon,
  FileIcon,
  GlobeIcon,
  TagIcon,
  EllipsisIcon,
  EyeOffIcon,
  FingerprintIcon,
  LinkIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getEvent,
  getIssueDetail,
  getIssueEvents,
  serializeIssueFilters,
  updateIssue,
  type EventDetail,
  type IssueDetailResponse,
  type StoredIssueStatus,
  type IssueFilters,
} from "@/lib/api/issues";
import { listMembers, listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { sessionEventHref } from "@/lib/api/sessions";
import { culpritFrame } from "./displayFrames";
import { EventBreadcrumbs, EventRelatedApis, FactGrid } from "./EventContext";
import { eventFacts } from "./eventFacts";
import {
  BrowserBrandIcon,
  DeviceTypeIcon,
  OsBrandIcon,
} from "@/features/sessions/SessionClientMeta";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import { IssueStatusLabel } from "./IssueStatusLabel";
import { StackTrace } from "./StackTrace";
import { TagPreview } from "./TagSummary";
import { tagFilterTitles, tagValueLabel, type TagFilterKey } from "./tagLabels";
import { useIssueFilters } from "./useIssueFilters";
import { IssueTrend } from "./IssueTrend";
import { formatAbsoluteTime, formatRelativeTime, isNewInRange } from "./issueTime";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import "./issues.css";

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
  const { filters, update } = useIssueFilters(project.id);
  // A changed analysis context owns a fresh sample selection and pagination.
  const scope = JSON.stringify([
    project.id,
    fingerprint,
    filters.from,
    filters.to,
    filters.environment,
    filters.release,
    filters.browser,
    filters.deviceType,
    filters.country,
    filters.route,
  ]);
  return (
    <IssueInvestigation
      key={scope}
      project={project}
      organizationId={organizationId}
      fingerprint={fingerprint}
      filters={filters}
      onFilter={(key, value) => update({ [key]: value, cursor: undefined })}
    />
  );
}

function IssueInvestigation({
  project,
  organizationId,
  fingerprint,
  filters,
  onFilter,
}: {
  project: Project;
  organizationId: string;
  fingerprint: string;
  filters: IssueFilters;
  onFilter: (key: TagFilterKey, value?: string) => void;
}) {
  const queryClient = useQueryClient();
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
    filters.route,
    TIME_SERIES_MAX_POINTS,
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
      filters.environment,
      filters.release,
      filters.browser,
      filters.deviceType,
      filters.country,
      filters.route,
      eventCursor,
    ],
    queryFn: ({ signal }) => getIssueEvents(filters, fingerprint, eventCursor, signal),
  });
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("event") ?? undefined,
  );
  // After paging back to newer events, continue from the oldest one on that page.
  const [selectLastOnPage, setSelectLastOnPage] = useState(false);
  const pageEvents = samples.data?.events ?? [];
  const eventId =
    selectedEventId ??
    (selectLastOnPage ? pageEvents[pageEvents.length - 1] : pageEvents[0])?.eventId;
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
    mutationFn: (patch: { status?: StoredIssueStatus; assigneeUserId?: string }) =>
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["issues", project.id] });
      void queryClient.invalidateQueries({ queryKey: ["issue", project.id, fingerprint] });
    },
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
  const sampleIndex = pageEvents.findIndex((item) => item.eventId === eventId);
  const hasNewerPage = cursorHistory.length > 0;
  const hasOlderPage = Boolean(samples.data?.nextCursor);
  const isNew = isNewInRange(issue.firstSeenAt, filters.from);
  const culprit = event.data ? culpritFrame(event.data) : undefined;
  const assignee = members.data?.members.find((member) => member.userId === issue.assigneeUserId);
  const copy = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(success);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };
  const goToPage = (cursor: string | undefined, history: string[], selectLast: boolean) => {
    setCursorHistory(history);
    setEventCursor(cursor || undefined);
    setSelectedEventId(undefined);
    setSelectLastOnPage(selectLast);
  };
  const navigation = {
    latest: () => goToPage(undefined, [], false),
    newer: () => {
      if (sampleIndex > 0) setSelectedEventId(pageEvents[sampleIndex - 1].eventId);
      else if (hasNewerPage) {
        const history = [...cursorHistory];
        const previous = history.pop();
        goToPage(previous, history, true);
      }
    },
    older: () => {
      if (sampleIndex >= 0 && sampleIndex < pageEvents.length - 1)
        setSelectedEventId(pageEvents[sampleIndex + 1].eventId);
      else if (samples.data?.nextCursor)
        goToPage(samples.data.nextCursor, [...cursorHistory, eventCursor ?? ""], false);
    },
  };
  const isLatest = !hasNewerPage && sampleIndex <= 0;
  return (
    <ConsolePage width="fluid" className="issue-investigation">
      <ConsolePageHeader
        back={
          <a
            className="issue-back-link"
            href={`/projects/${encodeURIComponent(project.id)}/issues?${serializeIssueFilters(filters)}`}
          >
            <ArrowLeftIcon />
            返回问题列表
          </a>
        }
        title={
          <span className="issue-title-row">
            <span className="issue-title-type">{issue.errorType}</span>
            {culprit ? (
              <span className="issue-title-culprit" title={culprit.location}>
                {culprit.function ? `${culprit.function}(${culprit.file})` : culprit.file}
              </span>
            ) : null}
          </span>
        }
        description={
          <span className="issue-header-summary">
            <span className="issue-header-message">{issue.title}</span>
            <span className="issue-header-badges">
              <IssueStatusLabel status={issue.status} />
              {isNew ? (
                <Badge variant="warning" title="首次发生在当前时间范围内">
                  新问题
                </Badge>
              ) : null}
              <span>
                最近{" "}
                <time dateTime={issue.lastSeenAt} title={formatAbsoluteTime(issue.lastSeenAt)}>
                  {formatRelativeTime(issue.lastSeenAt)}
                </time>
              </span>
            </span>
          </span>
        }
      />
      <ConsolePageContent className="issue-content">
        <div className="issue-workflow">
          {issue.status === "unresolved" || issue.status === "regressed" ? (
            <>
              <Button
                disabled={!canChange || mutation.isPending}
                onClick={() => mutation.mutate({ status: "resolved" })}
              >
                <CheckIcon />
                标记解决
              </Button>
              <Button
                variant="outline"
                disabled={!canChange || mutation.isPending}
                onClick={() => mutation.mutate({ status: "ignored" })}
              >
                <EyeOffIcon />
                忽略
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
          {canChange ? (
            <Select
              value={issue.assigneeUserId ?? "none"}
              disabled={mutation.isPending || members.isLoading || Boolean(members.error)}
              onValueChange={(value) =>
                mutation.mutate({ assigneeUserId: value === "none" ? "" : value })
              }
            >
              <SelectTrigger
                aria-label="负责人"
                className="issue-assignee"
                title={members.error ? "成员列表加载失败，暂不可分配" : "负责人"}
              >
                <UserRoundIcon data-icon="inline-start" />
                <SelectValue placeholder="未分配" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">未分配</SelectItem>
                  {issue.assigneeUserId && !assignee ? (
                    <SelectItem value={issue.assigneeUserId}>已分配成员</SelectItem>
                  ) : null}
                  {members.data?.members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.displayName || member.email}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="更多操作">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void copy(window.location.href, "问题链接已复制")}>
                <LinkIcon />
                复制问题链接
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copy(issue.fingerprint, "指纹已复制")}>
                <FingerprintIcon />
                复制问题指纹
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {mutation.error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>更新失败，已恢复原状态</AlertTitle>
            <AlertDescription>请确认权限与服务状态后重试。</AlertDescription>
          </Alert>
        ) : null}
        <div className="issue-layout">
          <div className="issue-main">
            <ActiveTagFilters filters={filters} onFilter={onFilter} />
            <IssueTrend
              trend={detail.data.trend}
              range={detail.data}
              totals={{ events: issue.events, users: issue.users }}
              tags={
                <TagPreview
                  facets={detail.data.facets}
                  total={issue.events}
                  filters={filters}
                  onFilter={onFilter}
                />
              }
            />
            <section className="issue-panel issue-events" aria-labelledby="issue-events-title">
              <EventNavigation
                event={event.data}
                loading={samples.isLoading || event.isLoading}
                position={sampleIndex}
                pageSize={pageEvents.length}
                isLatest={isLatest}
                canNewer={sampleIndex > 0 || hasNewerPage}
                canOlder={(sampleIndex >= 0 && sampleIndex < pageEvents.length - 1) || hasOlderPage}
                onLatest={navigation.latest}
                onNewer={navigation.newer}
                onOlder={navigation.older}
                onCopyId={(id) => void copy(id, "事件 ID 已复制")}
                allEvents={
                  <SamplesPanel
                    loading={samples.isLoading}
                    events={pageEvents}
                    issueTitle={issue.title}
                    selected={eventId}
                    onSelect={setSelectedEventId}
                    hasPrevious={!samples.isFetching && hasNewerPage}
                    hasNext={!samples.isFetching && hasOlderPage}
                    onPrevious={() => {
                      const history = [...cursorHistory];
                      const previous = history.pop();
                      goToPage(previous, history, false);
                    }}
                    onNext={() =>
                      samples.data?.nextCursor
                        ? goToPage(
                            samples.data.nextCursor,
                            [...cursorHistory, eventCursor ?? ""],
                            false,
                          )
                        : undefined
                    }
                  />
                }
              />
              {samples.error ? (
                <IssueDetailError
                  title="无法加载事件样本"
                  description="可重试加载；问题影响与趋势仍然可用。"
                  onRetry={() => void samples.refetch()}
                  compact
                />
              ) : null}
              {event.isLoading ? <Skeleton className="m-4 h-96" /> : null}
              {event.error ? (
                <IssueDetailError
                  title="事件详情暂不可用"
                  description="Issue 聚合数据仍然可用；可切换其他事件或稍后重试。"
                  onRetry={() => void event.refetch()}
                  compact
                />
              ) : null}
              {!samples.isLoading && !samples.error && !pageEvents.length ? (
                <p className="issue-empty-copy">当前筛选下没有可查看的事件。</p>
              ) : null}
              {event.data ? <EventSections key={event.data.eventId} event={event.data} /> : null}
            </section>
          </div>
          <aside className="issue-sidebar" aria-label="问题信息">
            <SidebarItem label="首次发生">
              <time dateTime={issue.firstSeenAt}>{formatRelativeTime(issue.firstSeenAt)}</time>
              <small>{formatAbsoluteTime(issue.firstSeenAt)}</small>
            </SidebarItem>
            <SidebarItem label="最近发生">
              <time dateTime={issue.lastSeenAt}>{formatRelativeTime(issue.lastSeenAt)}</time>
              <small>{formatAbsoluteTime(issue.lastSeenAt)}</small>
            </SidebarItem>
            <SidebarItem label="影响会话">
              <span>{issue.sessions.toLocaleString()}</span>
              <small>当前时间与筛选范围内去重</small>
            </SidebarItem>
            <SidebarItem label="负责人">
              <span>
                {assignee
                  ? assignee.displayName || assignee.email
                  : issue.assigneeUserId
                    ? "已分配"
                    : "未分配"}
              </span>
            </SidebarItem>
            <SidebarItem label="问题指纹">
              <code className="issue-sidebar__fingerprint" title={issue.fingerprint}>
                {issue.fingerprint}
              </code>
              <small>相同指纹的错误聚合为这个问题（v{issue.fingerprintVersion}）。</small>
            </SidebarItem>
          </aside>
        </div>
      </ConsolePageContent>
    </ConsolePage>
  );
}

function SidebarItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="issue-sidebar__item">
      <h2>{label}</h2>
      <div>{children}</div>
    </section>
  );
}

/** Applied tag filters as removable tokens, so a narrowed page never looks like the whole Issue. */
function ActiveTagFilters({
  filters,
  onFilter,
}: {
  filters: IssueFilters;
  onFilter: (key: TagFilterKey, value?: string) => void;
}) {
  const active = (Object.keys(tagFilterTitles) as TagFilterKey[]).filter((key) => filters[key]);
  if (!active.length) return null;
  return (
    <div className="issue-active-filters" aria-label="已应用的标签筛选">
      <span>只看</span>
      {active.map((key) => (
        <Badge key={key} variant="secondary" className="issue-active-filter">
          {tagFilterTitles[key]}：{tagValueLabel(key, filters[key]!)}
          <button
            type="button"
            aria-label={`移除筛选：${tagFilterTitles[key]}`}
            onClick={() => onFilter(key, undefined)}
          >
            <XIcon />
          </button>
        </Badge>
      ))}
    </div>
  );
}

const eventSectionLinks = [
  ["event-stack", "堆栈追踪"],
  ["event-breadcrumbs", "行为时间线"],
  ["event-requests", "相关请求"],
  ["event-tags", "标签与上下文"],
] as const;

/** Header of the events card: Sentry's "Events in this issue" with stepping and the event list. */
function EventNavigation({
  event,
  loading,
  position,
  pageSize,
  isLatest,
  canNewer,
  canOlder,
  onLatest,
  onNewer,
  onOlder,
  onCopyId,
  allEvents,
}: {
  event?: EventDetail;
  loading: boolean;
  position: number;
  pageSize: number;
  isLatest: boolean;
  canNewer: boolean;
  canOlder: boolean;
  onLatest: () => void;
  onNewer: () => void;
  onOlder: () => void;
  onCopyId: (eventId: string) => void;
  allEvents: React.ReactNode;
}) {
  return (
    <>
      <header className="issue-events__header">
        <h2 id="issue-events-title">本问题的事件</h2>
        <nav className="issue-events__nav" aria-label="事件导航">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="较新的事件"
            disabled={!canNewer}
            onClick={onNewer}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="较早的事件"
            disabled={!canOlder}
            onClick={onOlder}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            size="sm"
            variant={isLatest ? "secondary" : "ghost"}
            aria-pressed={isLatest}
            onClick={onLatest}
          >
            最新
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                全部事件
              </Button>
            </SheetTrigger>
            <SheetContent className="issue-events-sheet data-[side=right]:w-[min(1120px,94vw)] data-[side=right]:sm:max-w-none">
              <SheetHeader>
                <SheetTitle>全部事件</SheetTitle>
                <SheetDescription>当前时间与筛选范围内的事件，最新的在最上方。</SheetDescription>
              </SheetHeader>
              {allEvents}
            </SheetContent>
          </Sheet>
        </nav>
      </header>
      <div className="issue-event-bar">
        <div className="issue-event-bar__current">
          {event ? (
            <>
              <button
                type="button"
                className="issue-event-bar__id"
                title="复制事件 ID"
                onClick={() => onCopyId(event.eventId)}
              >
                <code>{event.eventId.replaceAll("-", "").slice(0, 12)}</code>
                <CopyIcon aria-hidden="true" />
              </button>
              <time dateTime={event.timestamp} title={formatAbsoluteTime(event.timestamp)}>
                {formatRelativeTime(event.timestamp)}
              </time>
              {position >= 0 && pageSize > 1 ? (
                <span className="issue-event-bar__count">
                  {isLatest ? "最新事件 · " : ""}本页第 {position + 1} / {pageSize} 个
                </span>
              ) : null}
            </>
          ) : loading ? (
            <span className="issue-event-bar__count">加载中…</span>
          ) : null}
        </div>
        <div className="issue-event-bar__links">
          <span>跳转到</span>
          {eventSectionLinks.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

/** The selected event: a client summary row, then Sentry-ordered foldable sections. */
function EventSections({ event }: { event: EventDetail }) {
  return (
    <div className="issue-event">
      <EventClientRow event={event} />
      <EventSection id="event-stack" title="堆栈追踪">
        <StackTrace event={event} />
      </EventSection>
      <EventSection
        id="event-breadcrumbs"
        title="行为时间线"
        description="错误前 15 分钟到后 5 分钟，同一会话中的页面、操作、请求与错误。"
        action={
          <Button asChild variant="ghost" size="sm">
            <a
              href={sessionEventHref(
                event.projectId,
                event.sessionId,
                event.timestamp,
                event.eventId,
              )}
            >
              打开完整会话
            </a>
          </Button>
        }
      >
        <EventBreadcrumbs event={event} />
      </EventSection>
      <EventSection id="event-requests" title={`相关请求 · ${event.relatedApis.length}`}>
        <EventRelatedApis event={event} />
      </EventSection>
      <EventSection id="event-tags" title="标签与上下文" defaultOpen={false}>
        <FactGrid facts={eventFacts(event)} label="事件标签与上下文" />
      </EventSection>
    </div>
  );
}

/** Who and where, at a glance: Sentry's highlight row of user, browser, system and more. */
function EventClientRow({ event }: { event: EventDetail }) {
  const items: { key: string; icon: React.ReactNode; label: string; detail?: string }[] = [];
  if (event.visitorId)
    items.push({
      key: "visitor",
      icon: <UserRoundIcon aria-hidden="true" />,
      label: "匿名访客",
      detail: event.visitorId.slice(0, 8),
    });
  if (event.browser)
    items.push({
      key: "browser",
      icon: <BrowserBrandIcon browser={event.browser} />,
      label: event.browser,
      detail: event.browserVersion,
    });
  if (event.os)
    items.push({
      key: "os",
      icon: <OsBrandIcon os={event.os} />,
      label: event.os,
      detail: event.osVersion,
    });
  if (event.deviceType)
    items.push({
      key: "device",
      icon: <DeviceTypeIcon deviceType={event.deviceType} />,
      label: deviceLabel(event.deviceType),
    });
  if (event.country)
    items.push({
      key: "country",
      icon: <GlobeIcon aria-hidden="true" />,
      label: countryLabel(event.country),
    });
  if (event.release)
    items.push({
      key: "release",
      icon: <TagIcon aria-hidden="true" />,
      label: event.release,
      detail: event.environment,
    });
  items.push({
    key: "page",
    icon: <FileIcon aria-hidden="true" />,
    label: event.route || event.pageUrl,
  });
  return (
    <ul className="issue-event-client" aria-label="事件关键信息">
      {items.map((item) => (
        <li key={item.key} title={[item.label, item.detail].filter(Boolean).join(" ")}>
          {item.icon}
          <span>{item.label}</span>
          {item.detail ? <small>{item.detail}</small> : null}
        </li>
      ))}
    </ul>
  );
}

function EventSection({
  id,
  title,
  description,
  action,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="issue-event-section" aria-labelledby={`${id}-title`}>
      <header className="issue-event-section__header">
        <h3 id={`${id}-title`}>{title}</h3>
        <div className="issue-event-section__actions">
          {open ? action : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            aria-label={open ? `收起${title}` : `展开${title}`}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDownIcon className="issue-event-section__chevron" />
          </Button>
        </div>
      </header>
      {open ? (
        <div id={`${id}-body`} className="issue-event-section__body">
          {description ? <p className="issue-event-section__description">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

function SamplesPanel({
  loading,
  events,
  issueTitle,
  selected,
  onSelect,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  loading: boolean;
  events: Awaited<ReturnType<typeof getIssueEvents>>["events"];
  issueTitle: string;
  selected?: string;
  onSelect: (id: string) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="issue-samples">
      <div className="issue-events-table" role="table" aria-label="事件列表">
        <div className="issue-events-table__head" role="row">
          <span role="columnheader">时间</span>
          <span role="columnheader">事件 ID</span>
          <span role="columnheader">页面</span>
          <span role="columnheader">版本</span>
          <span role="columnheader">浏览器</span>
          <span role="columnheader">系统</span>
          <span role="columnheader">设备 / 地区</span>
          <span role="columnheader">处理</span>
        </div>
        <div className="issue-events-table__body" role="rowgroup">
          {events.map((item) => {
            const message =
              item.errorMessage && item.errorMessage !== issueTitle ? item.errorMessage : "";
            return (
              <SheetClose asChild key={item.eventId}>
                <button
                  type="button"
                  role="row"
                  className="issue-events-table__row"
                  aria-current={selected === item.eventId || undefined}
                  onClick={() => onSelect(item.eventId)}
                >
                  <span role="cell" className="issue-events-table__time">
                    <time dateTime={item.timestamp}>{formatRelativeTime(item.timestamp)}</time>
                    <small>{formatAbsoluteTime(item.timestamp)}</small>
                  </span>
                  <span role="cell">
                    <code>{item.eventId.replaceAll("-", "").slice(0, 12)}</code>
                  </span>
                  <span role="cell" className="issue-events-table__page" title={item.pageUrl}>
                    <code>{item.route || item.pageUrl}</code>
                    {message ? <small title={message}>{message}</small> : null}
                  </span>
                  <span role="cell">
                    {item.release || "—"}
                    <small>{item.environment}</small>
                  </span>
                  <span role="cell" className="issue-events-table__client">
                    {item.browser ? <BrowserBrandIcon browser={item.browser} /> : null}
                    <span>
                      {item.browser || "未知"}
                      <small>{item.browserVersion}</small>
                    </span>
                  </span>
                  <span role="cell" className="issue-events-table__client">
                    {item.os ? <OsBrandIcon os={item.os} /> : null}
                    <span>
                      {item.os || "未知"}
                      <small>{item.osVersion}</small>
                    </span>
                  </span>
                  <span role="cell">
                    {item.deviceType ? deviceLabel(item.deviceType) : "未知"}
                    <small>{item.country ? countryLabel(item.country) : ""}</small>
                  </span>
                  <span role="cell">
                    <Badge variant={item.handled ? "outline" : "destructive"}>
                      {item.handled ? "已捕获" : "未捕获"}
                    </Badge>
                  </span>
                </button>
              </SheetClose>
            );
          })}
          {loading ? <p className="issue-empty-copy">正在加载事件…</p> : null}
          {!loading && !events.length ? <p className="issue-empty-copy">没有可用事件。</p> : null}
        </div>
      </div>
      <footer>
        <span>本页 {events.length} 个事件</span>
        <div>
          <Button size="sm" variant="outline" disabled={!hasPrevious} onClick={onPrevious}>
            <ChevronLeftIcon />
            较新
          </Button>
          <Button size="sm" variant="outline" disabled={!hasNext} onClick={onNext}>
            较早
            <ChevronRightIcon />
          </Button>
        </div>
      </footer>
    </div>
  );
}

function IssueDetailSkeleton() {
  return (
    <ConsolePage width="wide" aria-label="正在加载问题详情">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="h-28" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-24" key={index} />
        ))}
      </div>
      <Skeleton className="h-96" />
    </ConsolePage>
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
  const alert = (
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
  return compact ? alert : <ConsolePage width="wide">{alert}</ConsolePage>;
}
