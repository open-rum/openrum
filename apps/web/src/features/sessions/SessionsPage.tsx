import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  FilterIcon,
  MonitorSmartphoneIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerOffIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AsyncError } from "@/components/ui/AsyncState";
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
import { Input } from "@/components/ui/input";
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
import { BehaviorTimeline } from "@/features/events/BehaviorTimeline";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import { getSessionTimeline } from "@/lib/api/issues";
import {
  getSessions,
  type SessionFilters,
  type SessionSummary,
  type SessionsResponse,
} from "@/lib/api/sessions";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";

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
      <Empty className="mx-auto mt-20 max-w-xl border border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>还没有可分析的会话</EmptyTitle>
          <EmptyDescription>创建项目并接入浏览器 SDK 后，会话会自动汇聚在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <ProjectSessions project={project} />;
}

function ProjectSessions({ project }: { project: Project }) {
  const analysisContext = useAnalysisContext();
  const fallbackTo = useMemo(() => roundedMinute(new Date()), []);
  const contextFrom = analysisContext?.from ?? new Date(fallbackTo.getTime() - 24 * 60 * 60 * 1000);
  const contextTo = analysisContext?.to ?? fallbackTo;
  // Other workspaces deep link here with ?search=<session id>.
  const initialSearch = useMemo(
    () => new URLSearchParams(window.location.search).get("search")?.trim() || undefined,
    [],
  );
  const [filters, setFilters] = useState<SessionFilters>(() => ({
    projectId: project.id,
    from: contextFrom,
    to: contextTo,
    environment: analysisContext?.environment,
    search: initialSearch,
    signal: "all",
    sort: "latest",
    page: 1,
  }));
  const [searchDraft, setSearchDraft] = useState(initialSearch ?? "");
  const [routeDraft, setRouteDraft] = useState("");
  const [minimumEventsDraft, setMinimumEventsDraft] = useState("");
  const [minimumDurationDraft, setMinimumDurationDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<SessionSummary>();
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
  const update = (patch: Partial<SessionFilters>) => {
    setSelected(undefined);
    setFilters((current) => ({
      ...current,
      ...patch,
      projectId: project.id,
      page: patch.page ?? 1,
    }));
  };
  return (
    <div className="sessions-page">
      <header className="behavior-header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> 会话
          </div>
          <h1>会话</h1>
          <p>从一次连续访问还原用户旅程，结合行为、错误、API 和性能信号快速定位问题。</p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label="刷新会话"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCwIcon />
        </Button>
      </header>

      <form
        className="session-filter-bar"
        aria-label="会话筛选"
        onSubmit={(event) => {
          event.preventDefault();
          update({
            search: searchDraft.trim() || undefined,
            route: routeDraft.trim() || undefined,
            minimumEvents: numberValue(minimumEventsDraft),
            minimumDuration: numberValue(minimumDurationDraft),
          });
        }}
      >
        <div className="session-search">
          <SearchIcon aria-hidden="true" />
          <Input
            aria-label="搜索会话"
            placeholder="搜索 Session ID、用户、路由或事件"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </div>
        <Select
          value={filters.signal}
          onValueChange={(value) => update({ signal: value as SessionFilters["signal"] })}
        >
          <SelectTrigger aria-label="关键信号">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部信号</SelectItem>
              <SelectItem value="error">发生错误</SelectItem>
              <SelectItem value="api_failure">API 失败</SelectItem>
              <SelectItem value="slow_api">慢请求 ≥ 1s</SelectItem>
              <SelectItem value="poor_vital">体验评分较差</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          aria-expanded={advanced}
          onClick={() => setAdvanced((value) => !value)}
        >
          <FilterIcon data-icon="inline-start" />
          更多筛选
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
        <Button type="submit">查询</Button>

        {advanced ? (
          <div className="session-filter-bar__advanced">
            <FacetSelect
              label="全部版本"
              value={filters.release}
              options={query.data?.facets.releases}
              onChange={(value) => update({ release: value })}
            />
            <FacetSelect
              label="全部浏览器"
              value={filters.browser}
              options={query.data?.facets.browsers}
              onChange={(value) => update({ browser: value })}
            />
            <FacetSelect
              label="全部设备"
              value={filters.deviceType}
              options={query.data?.facets.deviceTypes}
              onChange={(value) => update({ deviceType: value })}
            />
            <FacetSelect
              label="全部国家"
              value={filters.country}
              options={query.data?.facets.countries}
              onChange={(value) => update({ country: value })}
            />
            <Input
              aria-label="路由筛选"
              placeholder="经过路由，例如 /checkout"
              value={routeDraft}
              onChange={(event) => setRouteDraft(event.target.value)}
            />
            <Input
              aria-label="最少事件数"
              type="number"
              min="0"
              placeholder="最少事件数"
              value={minimumEventsDraft}
              onChange={(event) => setMinimumEventsDraft(event.target.value)}
            />
            <Input
              aria-label="最短会话时长"
              type="number"
              min="0"
              placeholder="最短时长（秒）"
              value={minimumDurationDraft}
              onChange={(event) => setMinimumDurationDraft(event.target.value)}
            />
            <Select
              value={filters.sort}
              onValueChange={(value) => update({ sort: value as SessionFilters["sort"] })}
            >
              <SelectTrigger aria-label="会话排序">
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchDraft("");
                setRouteDraft("");
                setMinimumEventsDraft("");
                setMinimumDurationDraft("");
                update({
                  environment: undefined,
                  release: undefined,
                  browser: undefined,
                  deviceType: undefined,
                  country: undefined,
                  route: undefined,
                  search: undefined,
                  signal: "all",
                  sort: "latest",
                  minimumEvents: undefined,
                  minimumDuration: undefined,
                });
              }}
            >
              清除全部
            </Button>
          </div>
        ) : null}
      </form>

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
        <div className="sessions-workspace" data-detail={selected ? "open" : "closed"}>
          <SessionTable
            sessions={query.data.sessions}
            selected={selected?.sessionId}
            onSelect={setSelected}
          />
          {selected ? (
            <SessionDetail
              projectId={project.id}
              session={selected}
              onClose={() => setSelected(undefined)}
            />
          ) : null}
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
    </div>
  );
}

function FacetSelect({
  label,
  value,
  options = [],
  onChange,
}: {
  label: string;
  value?: string;
  options?: { value: string; sessions: number }[];
  onChange: (value?: string) => void;
}) {
  return (
    <Select
      value={value ?? "all"}
      onValueChange={(next) => onChange(next === "all" ? undefined : next)}
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
                {option.value} · {option.sessions.toLocaleString()}
              </SelectItem>
            ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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
              <TableHead>环境</TableHead>
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
              >
                <TableCell>
                  <Button
                    variant="link"
                    className="session-identity"
                    onClick={() => onSelect(session)}
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
                <TableCell>
                  <Badge variant="outline">{session.environment || "—"}</Badge>
                </TableCell>
                <TableCell>
                  <div className="session-device">
                    <MonitorSmartphoneIcon />
                    <span>
                      {[session.country, session.deviceType, session.browser]
                        .filter(Boolean)
                        .join(" · ") || "未知设备"}
                    </span>
                  </div>
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

function SessionDetail({
  projectId,
  session,
  onClose,
}: {
  projectId: string;
  session: SessionSummary;
  onClose: () => void;
}) {
  const from = new Date(new Date(session.startedAt).getTime() - 60_000);
  const naturalTo = new Date(new Date(session.endedAt).getTime() + 60_000);
  const to = new Date(Math.min(naturalTo.getTime(), from.getTime() + 24 * 60 * 60 * 1000));
  const timeline = useQuery({
    queryKey: ["session-timeline", projectId, session.sessionId, from, to],
    queryFn: ({ signal }) => getSessionTimeline(projectId, session.sessionId, from, to, signal),
  });
  return (
    <Card className="session-detail-card">
      <CardHeader className="border-b">
        <div className="session-detail-card__title">
          <div>
            <CardTitle>{session.visitorId || "匿名用户"}</CardTitle>
            <CardDescription>{session.sessionId}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </CardHeader>
      <CardContent className="session-detail-card__content">
        <dl className="session-detail-facts">
          <div>
            <dt>时间</dt>
            <dd>
              {formatDateTime(session.startedAt)} – {formatTime(session.endedAt)}
            </dd>
          </div>
          <div>
            <dt>环境 / 版本</dt>
            <dd>
              {session.environment || "—"} · {session.release || "未标记"}
            </dd>
          </div>
          <div>
            <dt>设备</dt>
            <dd>
              {[session.country, session.deviceType, session.browser, session.os]
                .filter(Boolean)
                .join(" · ") || "—"}
            </dd>
          </div>
          <div>
            <dt>事件构成</dt>
            <dd>
              {session.pageViews} 页面 · {session.customEvents} 自定义 · {session.apiFailures} API
              失败
            </dd>
          </div>
        </dl>
        <div className="session-detail-card__timeline">
          <h3>行为时间线</h3>
          {timeline.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : null}
          {timeline.error ? (
            <AsyncError
              error={timeline.error}
              title="时间线加载失败"
              remediation="会话摘要仍可用，请稍后重试。"
              onRetry={() => void timeline.refetch()}
            />
          ) : null}
          {timeline.data ? (
            <BehaviorTimeline
              breadcrumbs={[]}
              sessionTimeline={timeline.data}
              projectId={projectId}
              from={from.toISOString()}
              to={to.toISOString()}
            />
          ) : null}
        </div>
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
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
