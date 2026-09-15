import { useInfiniteQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BracesIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilterIcon,
  GaugeIcon,
  LinkIcon,
  MousePointerClickIcon,
  PanelsTopLeftIcon,
  ScrollTextIcon,
  ServerIcon,
  UserRoundSearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HTTPError } from "@/lib/auth/session";
import {
  getSessionTimelinePage,
  type SessionEventKind,
  type SessionSummary,
  type SessionTimelineEvent,
} from "@/lib/api/sessions";
import { cn } from "@/lib/utils";
import { SessionClientMeta } from "./SessionClientMeta";
import {
  sessionListReturnHref,
  subscribeSessionLocation,
  updateSessionDetailSearch,
} from "./sessionNavigation";

const visibleKinds = ["page", "click", "custom", "error", "api", "log", "performance"] as const;
type VisibleKind = (typeof visibleKinds)[number];

const kindLabels: Record<VisibleKind, string> = {
  page: "页面",
  click: "点击",
  custom: "自定义",
  error: "错误",
  api: "API",
  log: "日志",
  performance: "性能",
};

export function SessionDetailPage() {
  const { projectId, sessionId } = useParams({ strict: false }) as {
    projectId?: string;
    sessionId?: string;
  };
  const search = useSyncExternalStore(
    subscribeSessionLocation,
    () => window.location.search,
    () => "",
  );
  const parameters = useMemo(() => new URLSearchParams(search), [search]);
  const from = parseDate(parameters.get("from"));
  const to = parseDate(parameters.get("to"));
  const selectedEventId = parameters.get("event") ?? undefined;
  const selectedKinds = parseKinds(parameters.get("types"));
  const apiKinds = toAPIKinds(selectedKinds);
  const validRange = Boolean(
    from && to && from < to && to.getTime() - from.getTime() <= 86_400_000,
  );
  const backHref =
    projectId && from && to ? sessionListReturnHref(projectId, parameters, from, to) : "/sessions";

  const timeline = useInfiniteQuery({
    queryKey: ["session-detail", projectId, sessionId, from, to, apiKinds],
    queryFn: ({ pageParam, signal }) =>
      getSessionTimelinePage(
        {
          projectId: projectId!,
          sessionId: sessionId!,
          from: from!,
          to: to!,
          cursor: pageParam || undefined,
          kinds: apiKinds,
          limit: 100,
        },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(projectId && sessionId && validRange),
    retry: (attempt, error) => !(error instanceof HTTPError && error.status < 500) && attempt < 2,
  });
  const summary = timeline.data?.pages[0]?.session;
  const events = useMemo(
    () => timeline.data?.pages.flatMap((page) => page.events) ?? [],
    [timeline.data?.pages],
  );
  const selected = events.find((event) => event.eventId === selectedEventId) ?? events[0];
  const availability = timeline.data?.pages[0]?.availability;
  useEffect(() => {
    if (
      selectedEventId &&
      !events.some((event) => event.eventId === selectedEventId) &&
      timeline.hasNextPage &&
      !timeline.isFetchingNextPage
    ) {
      void timeline.fetchNextPage();
    }
  }, [events, selectedEventId, timeline]);

  if (!validRange) {
    return (
      <ConsolePage width="fluid">
        <SessionState
          title="会话时间范围无效"
          description="该详情链接缺少准确的会话起止时间，或范围超过 24 小时。请从会话列表重新打开。"
        />
      </ConsolePage>
    );
  }

  if (timeline.error) {
    const status = timeline.error instanceof HTTPError ? timeline.error.status : undefined;
    if (status === 404 || status === 403) {
      return (
        <ConsolePage width="fluid">
          <SessionState
            title={status === 403 ? "没有权限查看该会话" : "会话不存在或数据已过期"}
            description={
              status === 403
                ? "当前账户无法访问这个项目。"
                : "会话可能已被清理、链接范围不正确，或从未成功上报。"
            }
          />
        </ConsolePage>
      );
    }
  }

  return (
    <ConsolePage width="fluid" className="session-detail-page">
      <ConsolePageHeader
        title="会话详情"
        description={
          summary ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span>
                {summary.userId || summary.visitorId || "匿名访客"} ·{" "}
                {formatDateTime(summary.startedAt)} – {formatDateTime(summary.endedAt)}
              </span>
              <SessionClientMeta
                country={summary.country}
                deviceType={summary.deviceType}
                browser={summary.browser}
                os={summary.os}
              />
            </div>
          ) : (
            "按页面阶段调查一次连续访问中的行为、错误、请求和性能信号。"
          )
        }
        back={
          <Button asChild variant="ghost" size="sm">
            <a href={backHref}>
              <ArrowLeftIcon data-icon="inline-start" />
              返回会话列表
            </a>
          </Button>
        }
        actions={
          summary ? (
            <>
              <Button variant="outline" onClick={() => void copyText(summary.sessionId)}>
                <CopyIcon data-icon="inline-start" />
                复制 Session ID
              </Button>
              <Button variant="outline" onClick={() => void copyText(window.location.href)}>
                <LinkIcon data-icon="inline-start" />
                复制分享链接
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`/projects/${encodeURIComponent(projectId!)}/sessions?search=${encodeURIComponent(summary.userId || summary.visitorId || summary.sessionId)}`}
                >
                  <UserRoundSearchIcon data-icon="inline-start" />
                  其他会话
                </a>
              </Button>
            </>
          ) : undefined
        }
      />

      <ConsoleFilterBar
        primary={
          <>
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <FilterIcon className="size-4" aria-hidden="true" />
              筛选事件类型
            </span>
            <Badge variant="secondary">
              {selectedKinds.length ? `已选 ${selectedKinds.length}` : "全部"}
            </Badge>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={selectedKinds}
              onValueChange={(value) => setKinds(value as VisibleKind[])}
              aria-label="筛选时间线事件类型"
            >
              {visibleKinds.map((kind) => {
                const Icon = visibleKindIcon(kind);
                return (
                  <ToggleGroupItem
                    key={kind}
                    value={kind}
                    aria-label={`筛选${kindLabels[kind]}事件`}
                  >
                    <Icon data-icon="inline-start" />
                    {kindLabels[kind]}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            {selectedKinds.length ? (
              <Button variant="ghost" size="sm" onClick={() => setKinds([])}>
                清除筛选
              </Button>
            ) : null}
          </>
        }
        secondary={
          <span className="text-xs text-muted-foreground">
            会话时间已锁定，不受全局时间筛选影响
          </span>
        }
      />

      <ConsolePageContent className="grid gap-6">
        {timeline.isLoading ? <DetailSkeleton /> : null}
        {timeline.error ? (
          <AsyncError
            error={timeline.error}
            title="会话查询失败"
            remediation="时间范围和事件筛选已保留，请稍后重试。"
            onRetry={() => void timeline.refetch()}
          />
        ) : null}
        {summary ? <SessionMetrics summary={summary} /> : null}
        {availability?.sampled ? (
          <AvailabilityNotice title="该会话经过采样">
            时间线只包含已保留事件，事件间隔不代表用户没有操作。
          </AvailabilityNotice>
        ) : null}
        {availability?.expiredLogs ? (
          <AvailabilityNotice title="部分日志已经过期">
            其他行为仍可调查，但日志事件可能不完整。
          </AvailabilityNotice>
        ) : null}
        {summary && events.length === 0 ? (
          <SessionState title="没有匹配的事件" description="清除事件类型筛选后再试。" />
        ) : null}
        {events.length ? (
          <div className="session-investigation-workspace">
            <section className="session-timeline-panel" aria-labelledby="session-timeline-title">
              <div className="session-timeline-panel__heading">
                <div>
                  <h2 id="session-timeline-title">统一事件时间线</h2>
                  <p>按页面阶段分组，共加载 {events.length} 条事件。</p>
                </div>
              </div>
              <SessionTimeline
                events={events}
                startedAt={summary?.startedAt ?? events[0]!.timestamp}
                selectedEventId={selected?.eventId}
                onSelect={selectEvent}
              />
              {timeline.hasNextPage ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={timeline.isFetchingNextPage}
                  onClick={() => void timeline.fetchNextPage()}
                >
                  {timeline.isFetchingNextPage ? "加载中…" : "加载更多（每次 100 条）"}
                </Button>
              ) : (
                <p className="session-timeline-end">已加载当前筛选下的全部事件</p>
              )}
            </section>
            <EventInspector event={selected} projectId={projectId!} from={from!} to={to!} />
          </div>
        ) : null}
      </ConsolePageContent>
    </ConsolePage>
  );
}

function SessionMetrics({ summary }: { summary: SessionSummary }) {
  const metrics = [
    ["时长", formatDuration(summary.durationSeconds)],
    ["页面", summary.pageViews.toLocaleString()],
    ["事件", summary.events.toLocaleString()],
    ["错误", summary.errors.toLocaleString()],
    ["API 失败", summary.apiFailures.toLocaleString()],
    ["LCP", summary.lcp ? `${Math.round(summary.lcp)} ms` : "—"],
    ["INP", summary.inp ? `${Math.round(summary.inp)} ms` : "—"],
    ["CLS", summary.cls ? summary.cls.toFixed(3) : "—"],
  ];
  return (
    <section className="session-metrics" aria-label="会话指标">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function SessionTimeline({
  events,
  startedAt,
  selectedEventId,
  onSelect,
}: {
  events: SessionTimelineEvent[];
  startedAt: string;
  selectedEventId?: string;
  onSelect: (eventId: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedEventId]);
  const groups = groupEvents(events);
  return (
    <div className="session-timeline-groups">
      {groups.map((group, groupIndex) => (
        <section key={`${group.route}:${groupIndex}`} className="session-route-stage">
          <header>
            <span>页面阶段 {groupIndex + 1}</span>
            <strong>{group.route}</strong>
          </header>
          <ol>
            {group.events.map((event) => {
              const Icon = eventIcon(event.kind);
              const active = event.eventId === selectedEventId;
              return (
                <li key={event.eventId}>
                  <button
                    ref={active ? selectedRef : undefined}
                    type="button"
                    className={cn("session-timeline-event", active && "is-selected")}
                    aria-current={active || undefined}
                    onClick={() => onSelect(event.eventId)}
                  >
                    <span className="session-timeline-event__icon" data-kind={event.kind}>
                      <Icon />
                    </span>
                    <span className="session-timeline-event__content">
                      <strong>{eventLabel(event)}</strong>
                      <small>{eventDescription(event)}</small>
                    </span>
                    <time dateTime={event.timestamp}>
                      {relativeTime(startedAt, event.timestamp)}
                    </time>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EventInspector({
  event,
  projectId,
  from,
  to,
}: {
  event?: SessionTimelineEvent;
  projectId: string;
  from: Date;
  to: Date;
}) {
  if (!event) return null;
  const fields = inspectorFields(event);
  return (
    <aside className="session-event-inspector" aria-label="事件检查器">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge variant="outline">{eventKindLabel(event.kind)}</Badge>
              <CardTitle className="mt-3">{eventLabel(event)}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copyText(event.eventId)}
              aria-label="复制事件 ID"
            >
              <CopyIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5">
          <dl className="session-inspector-fields">
            <InspectorField label="发生时间" value={formatDateTime(event.timestamp)} />
            <InspectorField label="Route" value={event.route || event.pageUrl || "—"} />
            {fields.map(([label, value]) => (
              <InspectorField key={label} label={label} value={value} />
            ))}
          </dl>
          {Object.keys(event.attributes).length ? (
            <StructuredData title="属性" data={event.attributes} />
          ) : null}
          {Object.keys(event.measurements ?? {}).length ? (
            <StructuredData title="测量值" data={event.measurements ?? {}} />
          ) : null}
          {event.kind === "error" && event.fingerprint ? (
            <Button asChild variant="outline">
              <a
                href={`/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(event.fingerprint)}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&event=${encodeURIComponent(event.eventId)}`}
              >
                查看 Issue 与源码
                <ExternalLinkIcon data-icon="inline-end" />
              </a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </aside>
  );
}

function SessionState({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-80 border border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertCircleIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function AvailabilityNotice({ title, children }: { title: string; children: string }) {
  return (
    <Alert>
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StructuredData({ title, data }: { title: string; data: Record<string, string | number> }) {
  return (
    <section className="session-structured-data">
      <h3>{title}</h3>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-[480px]" />
    </div>
  );
}

function parseDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseKinds(value: string | null): VisibleKind[] {
  if (!value) return [];
  return value
    .split(",")
    .filter((kind): kind is VisibleKind => visibleKinds.includes(kind as VisibleKind));
}

function setKinds(kinds: VisibleKind[]) {
  updateSessionDetailSearch(
    { types: kinds.length ? kinds.join(",") : undefined, event: undefined },
    "push",
  );
}

function selectEvent(eventId: string) {
  updateSessionDetailSearch({ event: eventId }, "replace");
}

function toAPIKinds(kinds: VisibleKind[]): SessionEventKind[] | undefined {
  if (!kinds.length) return undefined;
  const result = new Set<SessionEventKind>();
  for (const kind of kinds) {
    if (kind === "page") {
      result.add("page_view");
      result.add("navigation");
    } else if (kind === "performance") result.add("web_vital");
    else result.add(kind);
  }
  return [...result];
}

function groupEvents(events: SessionTimelineEvent[]) {
  const groups: { route: string; events: SessionTimelineEvent[] }[] = [];
  for (const event of events) {
    const route = event.route || event.pageUrl || groups.at(-1)?.route || "未识别页面";
    const last = groups.at(-1);
    if (!last || last.route !== route || event.kind === "navigation")
      groups.push({ route, events: [event] });
    else last.events.push(event);
  }
  return groups;
}

function eventIcon(kind: SessionEventKind) {
  if (kind === "error") return AlertCircleIcon;
  if (kind === "api") return ServerIcon;
  if (kind === "click") return MousePointerClickIcon;
  if (kind === "custom") return BracesIcon;
  if (kind === "web_vital") return GaugeIcon;
  return FileTextIcon;
}

function visibleKindIcon(kind: VisibleKind) {
  if (kind === "page") return PanelsTopLeftIcon;
  if (kind === "log") return ScrollTextIcon;
  if (kind === "performance") return GaugeIcon;
  return eventIcon(kind);
}

function eventKindLabel(kind: SessionEventKind) {
  return (
    {
      page_view: "页面访问",
      navigation: "页面导航",
      click: "点击",
      custom: "自定义事件",
      error: "错误",
      api: "API",
      log: "日志",
      web_vital: "性能",
    } as const
  )[kind];
}

function eventLabel(event: SessionTimelineEvent) {
  if (event.kind === "api") return `${event.apiMethod || "请求"} ${event.apiUrl || event.title}`;
  if (event.kind === "log")
    return `${event.logLevel?.toUpperCase() || "LOG"} · ${event.logMessage || event.title}`;
  if (event.kind === "web_vital")
    return `${event.metricName || event.title} ${formatMetric(event)}`;
  return event.title || eventKindLabel(event.kind);
}

function eventDescription(event: SessionTimelineEvent) {
  if (event.kind === "error") return event.errorMessage || "前端错误";
  if (event.kind === "api")
    return `${event.apiStatus || "—"} · ${Math.round(event.durationMs || 0)} ms`;
  if (event.kind === "click") return event.attributes.name || event.attributes.role || "交互目标";
  return event.route || event.pageUrl || eventKindLabel(event.kind);
}

function inspectorFields(event: SessionTimelineEvent): [string, string][] {
  if (event.kind === "error")
    return [
      ["类型", event.errorType || "Error"],
      ["消息", event.errorMessage || "—"],
      ["Handled", event.handled ? "是" : "否"],
      ["指纹", event.fingerprint || "—"],
      ["Mechanism", event.errorMechanism || "—"],
    ];
  if (event.kind === "api")
    return [
      ["方法", event.apiMethod || "—"],
      ["状态", String(event.apiStatus || "—")],
      ["耗时", `${Math.round(event.durationMs || 0)} ms`],
      ["失败原因", event.apiFailure || "—"],
      ["Trace", event.traceId || "—"],
    ];
  if (event.kind === "log")
    return [
      ["级别", event.logLevel || "—"],
      ["Logger", event.logger || "—"],
      ["内容", event.logMessage || "—"],
    ];
  if (event.kind === "web_vital")
    return [
      ["指标", event.metricName || "—"],
      ["值", formatMetric(event)],
      ["评级", event.metricRating || "—"],
      ["Delta", String(event.metricDelta ?? "—")],
    ];
  if (event.kind === "custom" || event.kind === "click")
    return [
      ["事件名", event.title],
      ["页面", event.pageTitle || event.pageUrl || "—"],
    ];
  return [
    ["页面标题", event.pageTitle || "—"],
    ["导航类型", event.navigationType || "—"],
    ["页面 URL", event.pageUrl || "—"],
  ];
}

function formatMetric(event: SessionTimelineEvent) {
  const value = event.metricValue ?? 0;
  return event.metricName === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`;
}

function relativeTime(start: string, value: string) {
  const milliseconds = Math.max(0, new Date(value).getTime() - new Date(start).getTime());
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `+${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}
