import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  RefreshCwIcon,
  ServerOffIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import {
  getSessions,
  type SessionFilters,
  type SessionSummary,
  type SessionsResponse,
} from "@/lib/api/sessions";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { SessionPreviewDrawer } from "./SessionPreviewDrawer";
import { SessionClientMeta } from "./SessionClientMeta";
import { SessionFilterComposer } from "./SessionFilterComposer";

export function SessionsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <SessionsSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project) {
    return (
      <ConsolePage width="narrow">
        <Empty className="min-h-80 border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>还没有可分析的会话</EmptyTitle>
            <EmptyDescription>创建项目并接入浏览器 SDK 后，会话会自动汇聚在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ConsolePage>
    );
  }
  return <ProjectSessions project={project} />;
}

function ProjectSessions({ project }: { project: Project }) {
  const analysisContext = useAnalysisContext();
  const fallbackTo = useMemo(() => roundedMinute(new Date()), []);
  const contextFrom = analysisContext?.from ?? new Date(fallbackTo.getTime() - 24 * 60 * 60 * 1000);
  const contextTo = analysisContext?.to ?? fallbackTo;
  const initial = useMemo(() => readSessionListSearch(), []);
  const [filters, setFilters] = useState<SessionFilters>(() => ({
    projectId: project.id,
    from: contextFrom,
    to: contextTo,
    environment: analysisContext?.environment,
    release: initial.release,
    browser: initial.browser,
    deviceType: initial.deviceType,
    country: initial.country,
    route: initial.route,
    search: initial.search,
    signal: initial.signal,
    sort: initial.sort,
    minimumEvents: initial.minimumEvents,
    minimumDuration: initial.minimumDuration,
    page: initial.page,
  }));
  const [previewID, setPreviewID] = useState(initial.preview);
  const previewPushed = useRef(false);
  const effectiveFilters = {
    ...filters,
    projectId: project.id,
    from: contextFrom,
    to: contextTo,
    environment: analysisContext?.environment,
  };
  const query = useQuery({
    queryKey: ["sessions", effectiveFilters],
    queryFn: ({ signal }) => getSessions(effectiveFilters, signal),
  });
  const selected = query.data?.sessions.find((session) => session.sessionId === previewID);
  useEffect(() => {
    syncSessionListSearch(filters);
  }, [filters]);
  useEffect(() => {
    const restorePreview = () => {
      const preview = new URLSearchParams(window.location.search).get("preview");
      setPreviewID(preview ?? undefined);
      previewPushed.current = false;
    };
    window.addEventListener("popstate", restorePreview);
    return () => window.removeEventListener("popstate", restorePreview);
  }, []);
  const update = (patch: Partial<SessionFilters>) => {
    setFilters((current) => ({
      ...current,
      ...patch,
      projectId: project.id,
      page: patch.page ?? 1,
    }));
  };
  const openPreview = (session: SessionSummary) => {
    const url = new URL(window.location.href);
    url.searchParams.set("preview", session.sessionId);
    window.history.pushState({}, "", url);
    window.dispatchEvent(new Event("openrum:urlchange"));
    previewPushed.current = true;
    setPreviewID(session.sessionId);
  };
  const closePreview = () => {
    if (previewPushed.current) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("preview");
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event("openrum:urlchange"));
    setPreviewID(undefined);
  };
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="会话"
        description="从一次连续访问还原用户旅程，结合行为、错误、API 和性能信号快速定位问题。"
        actions={
          <Button
            size="icon"
            variant="outline"
            aria-label="刷新会话"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon />
          </Button>
        }
      />

      <ConsoleFilterBar
        primary={
          <div className="session-filter-bar" aria-label="会话筛选">
            <SessionFilterComposer
              filters={effectiveFilters}
              facets={query.data?.facets}
              sessions={query.data?.sessions}
              onChange={update}
            />
            <Select
              value={filters.sort}
              onValueChange={(value) => update({ sort: value as SessionFilters["sort"] })}
            >
              <SelectTrigger aria-label="会话排序" className="session-sort-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="latest">最近活跃</SelectItem>
                  <SelectItem value="duration">会话时长</SelectItem>
                  <SelectItem value="events">事件数量</SelectItem>
                  <SelectItem value="errors">错误数量</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {hasSessionFilters(filters) ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  update({
                    release: undefined,
                    browser: undefined,
                    deviceType: undefined,
                    country: undefined,
                    route: undefined,
                    search: undefined,
                    signal: "all",
                    minimumEvents: undefined,
                    minimumDuration: undefined,
                  })
                }
              >
                清除筛选
              </Button>
            ) : null}
          </div>
        }
      />

      <ConsolePageContent className="grid gap-6">
        {query.data ? <SessionOverview data={query.data} /> : null}
        {query.isLoading ? <SessionsSkeleton compact /> : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title="无法加载会话"
            remediation="筛选条件已保留；请缩短时间范围或检查 ClickHouse 查询服务。"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data?.sessions.length ? (
          <div className="sessions-workspace">
            <SessionTable
              sessions={query.data.sessions}
              selected={selected?.sessionId}
              onSelect={openPreview}
            />
          </div>
        ) : null}
        {query.data && query.data.sessions.length === 0 ? (
          <Empty className="min-h-80 border border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ServerOffIcon />
              </EmptyMedia>
              <EmptyTitle>没有匹配的会话</EmptyTitle>
              <EmptyDescription>
                尝试扩大时间范围，或清除国家、设备、版本和异常信号筛选。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  const to = roundedMinute(new Date());
                  analysisContext?.update({
                    from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000),
                    to,
                  });
                }}
              >
                查看过去 7 天
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {query.data?.sessions.length ? (
          <footer className="sessions-pagination">
            <span>
              第 {filters.page} 页 · 本页 {query.data.sessions.length} 个会话
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={filters.page === 1}
                onClick={() => update({ page: filters.page - 1 })}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={!query.data.hasMore}
                onClick={() => update({ page: filters.page + 1 })}
              >
                下一页
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </footer>
        ) : null}
      </ConsolePageContent>
      <SessionPreviewDrawer
        projectId={project.id}
        session={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      />
    </ConsolePage>
  );
}

function SessionOverview({ data }: { data: SessionsResponse }) {
  const errorSessions = data.sessions.filter((session) => session.errors > 0).length;
  const apiFailureSessions = data.sessions.filter((session) => session.apiFailures > 0).length;
  const averageDuration = data.sessions.length
    ? Math.round(
        data.sessions.reduce((total, session) => total + session.durationSeconds, 0) /
          data.sessions.length,
      )
    : 0;
  return (
    <section className="session-overview" aria-label="本页会话摘要">
      <div>
        <UsersIcon />
        <span>本页会话</span>
        <strong>{data.sessions.length}</strong>
      </div>
      <div>
        <AlertTriangleIcon />
        <span>错误会话</span>
        <strong>{errorSessions}</strong>
      </div>
      <div>
        <ServerOffIcon />
        <span>API 失败会话</span>
        <strong>{apiFailureSessions}</strong>
      </div>
      <div>
        <Clock3Icon />
        <span>平均时长</span>
        <strong>{formatDuration(averageDuration)}</strong>
      </div>
    </section>
  );
}

function SessionTable({
  sessions,
  selected,
  onSelect,
}: {
  sessions: SessionSummary[];
  selected?: string;
  onSelect: (session: SessionSummary) => void;
}) {
  return (
    <Card className="session-table-card">
      <CardHeader className="border-b">
        <CardTitle>全部会话</CardTitle>
        <CardDescription>点击会话查看完整事件时间线。</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="session-table">
          <TableHeader>
            <TableRow>
              <TableHead>用户 / 会话</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>旅程</TableHead>
              <TableHead className="text-right">LCP</TableHead>
              <TableHead>设备</TableHead>
              <TableHead>信号</TableHead>
              <TableHead className="text-right">时长</TableHead>
              <TableHead className="text-right">事件</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow
                key={session.sessionId}
                data-state={selected === session.sessionId ? "selected" : undefined}
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => onSelect(session)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(session);
                }}
              >
                <TableCell>
                  <Button
                    variant="link"
                    className="session-identity"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(session);
                    }}
                  >
                    <strong>{session.visitorId || "匿名用户"}</strong>
                    <span>{shortID(session.sessionId)}</span>
                  </Button>
                </TableCell>
                <TableCell>
                  <time dateTime={session.startedAt}>{formatDateTime(session.startedAt)}</time>
                </TableCell>
                <TableCell>
                  <div className="session-route">
                    <strong>{session.entryRoute || "未知入口"}</strong>
                    <span>→ {session.exitRoute || session.entryRoute || "未知退出"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatLCP(session.lcp)}</TableCell>
                <TableCell>
                  <SessionClientMeta
                    country={session.country}
                    deviceType={session.deviceType}
                    browser={session.browser}
                    className="text-sm text-muted-foreground"
                  />
                </TableCell>
                <TableCell>
                  <div className="session-signals">
                    {session.errors ? (
                      <Badge variant="destructive">{session.errors} 错误</Badge>
                    ) : null}
                    {session.apiFailures ? (
                      <Badge variant="secondary">{session.apiFailures} API 失败</Badge>
                    ) : null}
                    {session.errors === 0 && session.apiFailures === 0 ? (
                      <Badge variant="outline">正常</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(session.durationSeconds)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{session.events}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SessionsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex flex-col gap-2" : "sessions-page"} aria-label="正在加载会话">
      <Skeleton className="h-24" />
      <Skeleton className="h-12" />
      <Skeleton className="h-96" />
    </div>
  );
}

function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}
function numberValue(value: string) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readSessionListSearch() {
  const parameters = new URLSearchParams(window.location.search);
  const signal = parameters.get("signal");
  const sort = parameters.get("sort");
  const page = Number(parameters.get("page"));
  const minimumEvents = numberValue(parameters.get("minimumEvents") ?? "");
  const minimumDuration = numberValue(parameters.get("minimumDuration") ?? "");
  return {
    release: parameters.get("release") || undefined,
    browser: parameters.get("browser") || undefined,
    deviceType: parameters.get("deviceType") || undefined,
    country: parameters.get("country") || undefined,
    route: parameters.get("route") || undefined,
    search: parameters.get("search")?.trim() || undefined,
    signal: (["error", "api_failure", "slow_api", "poor_vital"].includes(signal ?? "")
      ? signal
      : "all") as SessionFilters["signal"],
    sort: (["duration", "events", "errors"].includes(sort ?? "")
      ? sort
      : "latest") as SessionFilters["sort"],
    page: Number.isInteger(page) && page > 0 ? page : 1,
    minimumEvents,
    minimumDuration,
    preview: parameters.get("preview") || undefined,
  };
}

function hasSessionFilters(filters: SessionFilters) {
  return Boolean(
    filters.release ||
    filters.browser ||
    filters.deviceType ||
    filters.country ||
    filters.route ||
    filters.search ||
    filters.signal !== "all" ||
    filters.minimumEvents ||
    filters.minimumDuration,
  );
}

function syncSessionListSearch(filters: SessionFilters) {
  const url = new URL(window.location.href);
  const values: Record<string, string | number | undefined> = {
    release: filters.release,
    browser: filters.browser,
    deviceType: filters.deviceType,
    country: filters.country,
    route: filters.route,
    search: filters.search,
    signal: filters.signal === "all" ? undefined : filters.signal,
    sort: filters.sort === "latest" ? undefined : filters.sort,
    page: filters.page === 1 ? undefined : filters.page,
    minimumEvents: filters.minimumEvents,
    minimumDuration: filters.minimumDuration,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "" || value === 0) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new Event("openrum:urlchange"));
}
function shortID(value: string) {
  return value.slice(0, 8);
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatLCP(milliseconds?: number) {
  if (milliseconds === undefined) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}
