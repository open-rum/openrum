import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { DownloadIcon, FileTextIcon, RefreshCwIcon } from "lucide-react";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getLogs, logSearchTerm, type LogEntry, type LogFilters } from "@/lib/api/logs";
import { LogDetails, LogLevelBadge } from "./LogDetails";
import { LogFilterComposer } from "./LogFilterComposer";
import { LogTrend } from "./LogTrend";
import "./logs.css";

const legacyDimensionKeys = ["country", "deviceType", "route", "browser", "release"] as const;

export function LogsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const context = useAnalysisContext();
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const fallbackTo = useMemo(() => new Date(), []);
  const params = new URLSearchParams(search);
  const hasLegacyDimensions = legacyDimensionKeys.some((key) => params.has(key));
  useEffect(() => {
    // Removed sidebar filters must not survive as invisible constraints in old links.
    const url = new URL(window.location.href);
    if (!legacyDimensionKeys.some((key) => url.searchParams.has(key))) return;
    for (const key of legacyDimensionKeys) url.searchParams.delete(key);
    url.searchParams.delete("cursor");
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event("openrum:urlchange"));
  }, [search]);
  const filters: LogFilters = {
    projectId,
    from: (context?.from ?? new Date(fallbackTo.getTime() - 86400000)).toISOString(),
    to: (context?.to ?? fallbackTo).toISOString(),
    environment: context?.environment,
    q: params.get("q") || undefined,
    level: params.get("level") || undefined,
    cursor: hasLegacyDimensions ? undefined : params.get("cursor") || undefined,
  };
  const update = (patch: Partial<LogFilters>) => {
    const next = new URLSearchParams(window.location.search);
    next.set("from", filters.from);
    next.set("to", filters.to);
    next.delete("cursor");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    window.history.pushState({}, "", `${window.location.pathname}?${next}`);
    window.dispatchEvent(new Event("openrum:urlchange"));
  };
  // A global context change closes an old detail. Query-token changes keep the
  // shared composer mounted so several conditions can be added in sequence.
  return (
    <LogWorkspace
      key={`${filters.projectId}:${filters.from}:${filters.to}:${filters.environment ?? "all"}`}
      filters={filters}
      update={update}
      ready={Boolean(context)}
    />
  );
}

function LogWorkspace({
  filters,
  update,
  ready,
}: {
  filters: LogFilters;
  update: (patch: Partial<LogFilters>) => void;
  ready: boolean;
}) {
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const query = useQuery({
    queryKey: ["logs", filters],
    queryFn: ({ signal }) => getLogs(filters, signal),
    enabled: ready,
  });
  const data = query.data;
  const addFilter = (key: string, value: string) => {
    update({ q: [filters.q, logSearchTerm(key, value)].filter(Boolean).join(" ") });
    setSelected(null);
  };
  const exportPage = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([data.items.map((item) => JSON.stringify(item)).join("\n")], {
        type: "application/x-ndjson",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "openrum-logs-page.jsonl";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="日志"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
        }
      />
      <ConsoleFilterBar
        primary={<LogFilterComposer filters={filters} items={data?.items} onChange={update} />}
      />
      <ConsolePageContent className="grid gap-4">
        <details className="logs-search-help">
          <summary>搜索语法</summary>
          <p>
            关键词匹配正文（区分大小写），多个条件同时满足。支持
            severity、logger、environment、release、route、country、device、browser、trace_id、session_id
            和自定义属性；用户 ID 用 user.id（也支持 user_id、userId），匿名访客用
            anonymous_user_id。 含空格的值用双引号包裹。暂不支持 OR、通配符和数值比较。
          </p>
          <code>user.id:"customer-123" severity:error</code>
        </details>
        {query.isLoading || !ready ? (
          <div className="grid gap-4" aria-label="正在加载日志">
            <Skeleton className="h-56" />
            <Skeleton className="h-96" />
          </div>
        ) : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title="日志加载失败"
            remediation="筛选已保留；检查搜索语法，或缩短时间范围后重试。"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {data && !query.error ? (
          <>
            <LogTrend data={data} from={filters.from} to={filters.to} />
            <Card className="min-w-0">
              <CardHeader className="logs-table-heading">
                <CardTitle>
                  日志列表{" "}
                  <span className="text-muted-foreground">{data.total.toLocaleString()}</span>
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!data.items.length}
                  onClick={exportPage}
                >
                  <DownloadIcon data-icon="inline-start" />
                  导出本页
                </Button>
              </CardHeader>
              <CardContent className="px-0">
                {data.items.length ? (
                  <Table aria-label="日志列表" className="logs-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">时间 ↓</TableHead>
                        <TableHead>级别</TableHead>
                        <TableHead>消息</TableHead>
                        <TableHead>来源 / 路由</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((item) => (
                        <TableRow key={item.eventId}>
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">
                            <time dateTime={item.timestamp}>
                              {new Date(item.timestamp).toLocaleString("zh-CN", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false,
                              })}
                            </time>
                          </TableCell>
                          <TableCell>
                            <LogLevelBadge level={item.level} />
                          </TableCell>
                          <TableCell className="w-full min-w-48">
                            <button
                              type="button"
                              className="logs-message-button"
                              onClick={() => setSelected(item)}
                            >
                              {item.message}
                            </button>
                          </TableCell>
                          <TableCell className="max-w-48">
                            <div className="truncate text-xs">{item.logger || "应用"}</div>
                            <div
                              className="truncate text-xs text-muted-foreground"
                              title={item.route}
                            >
                              {item.route || "—"}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <>
                    <EmptyState
                      icon={FileTextIcon}
                      title="当前范围没有日志"
                      description="尝试调整时间、环境或搜索条件。尚未接入时，请在浏览器 SDK 中显式启用日志。"
                    />
                    <pre className="logs-setup">
                      {
                        'const rum = OpenRUM.init({ dsn: "你的 DSN", enableLogs: true });\nrum.logger.info("checkout started", { "order.id": "123" });'
                      }
                    </pre>
                    <div className="px-4">
                      <Button asChild variant="link">
                        <a href={`/projects/${filters.projectId}/onboarding`}>查看项目接入信息</a>
                      </Button>
                    </div>
                  </>
                )}
                <div className="logs-pagination">
                  <span>{data.items.length} 条 / 页 · 最新优先</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!filters.cursor || query.isFetching}
                      onClick={() => update({ cursor: undefined })}
                    >
                      回到最新
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!data.nextCursor || query.isFetching}
                      onClick={() => update({ cursor: data.nextCursor })}
                    >
                      更早日志
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </ConsolePageContent>
      <LogDetails
        entry={selected}
        projectId={filters.projectId}
        from={filters.from}
        to={filters.to}
        onClose={() => setSelected(null)}
        onFilter={addFilter}
      />
    </ConsolePage>
  );
}

function subscribeLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("openrum:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("openrum:urlchange", callback);
  };
}
