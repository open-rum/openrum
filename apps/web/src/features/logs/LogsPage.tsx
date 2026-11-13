import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  CircleHelpIcon,
} from "lucide-react";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import { getLog, getLogs, logSearchTerm, type LogEntry, type LogFilters } from "@/lib/api/logs";
import { searchErrorFrom } from "@/lib/api/search";
import { equalsTerm, foldIntoQuery } from "@/lib/search/legacy";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import { LogDetails } from "./LogDetails";
import { LogFilterComposer } from "./LogFilterComposer";
import { LogTrend } from "./LogTrend";
import { logDetailKey } from "./logNavigation";
import { LogColumnPicker } from "./LogColumnPicker";
import { LogTable } from "./LogTable";
import { logColumnLabel, readLogColumns, withLogFilter } from "./logPresentation";
import "./logs.css";

const legacyKeys = ["level", "country", "deviceType", "route", "browser", "release"] as const;
const pageSizes = [50, 100];
const legacyFields = {
  level: "level",
  country: "country",
  deviceType: "device",
  route: "route",
  browser: "browser",
  release: "release",
};
type LogPatch = Partial<LogFilters> & { log?: string; logAt?: string; returnTo?: string };
type Navigate = (patch: LogPatch, options?: { freeze?: boolean }) => void;

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
  const requestedLimit = Number(params.get("limit"));
  const hasLegacy = legacyKeys.some((key) => params.has(key));
  const q = foldIntoQuery(
    params.get("q"),
    legacyKeys.map((key) => {
      const value = params.get(key)?.trim();
      return value ? equalsTerm(legacyFields[key], value) : undefined;
    }),
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!legacyKeys.some((key) => url.searchParams.has(key))) return;
    for (const key of legacyKeys) url.searchParams.delete(key);
    url.searchParams.delete("cursor");
    if (q) url.searchParams.set("q", q);
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event("openrum:urlchange"));
  }, [search, q]);
  const filters: LogFilters = {
    projectId,
    from: (context?.from ?? new Date(fallbackTo.getTime() - 86400000)).toISOString(),
    to: (context?.to ?? fallbackTo).toISOString(),
    environment: context?.environment,
    q,
    cursor: hasLegacy ? undefined : params.get("cursor") || undefined,
    limit: pageSizes.includes(requestedLimit) ? requestedLimit : 50,
    anchor: params.get("anchor") || undefined,
    anchorAt: params.get("anchorAt") || undefined,
    direction: !params.get("cursor")
      ? undefined
      : params.get("direction") === "before"
        ? "before"
        : params.get("direction") === "after"
          ? "after"
          : undefined,
  };
  const navigate: Navigate = (patch, options) => {
    const next = new URLSearchParams(window.location.search);
    next.set("from", filters.from);
    next.set("to", filters.to);
    if (options?.freeze) next.delete("timePreset");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    writeSearch(next);
  };
  // Relative time advances the query, not the investigation workspace or its open detail.
  return (
    <LogWorkspace
      key={projectId}
      filters={filters}
      search={search}
      navigate={navigate}
      ready={Boolean(context)}
    />
  );
}

function LogWorkspace({
  filters,
  search,
  navigate,
  ready,
}: {
  filters: LogFilters;
  search: string;
  navigate: Navigate;
  ready: boolean;
}) {
  const client = useQueryClient();
  const storageKey = `openrum:log-columns:${filters.projectId}`;
  const [columns, setColumns] = useState(() => readLogColumns(storageKey));
  const [locateVersion, setLocateVersion] = useState(0);
  const contextMode = Boolean(filters.anchor && filters.anchorAt);
  const updateColumns = (next: string[]) => {
    setColumns(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* The current selection still works when storage is blocked. */
    }
  };
  const addColumn = (key: string) => {
    if (!columns.includes(key)) updateColumns([...columns, key]);
    toast.success(`已添加 ${logColumnLabel(key)} 列`);
  };
  const [pages, setPages] = useState<{ scope: string; cursors: Array<string | undefined> }>({
    scope: "",
    cursors: [undefined],
  });
  const params = new URLSearchParams(search);
  const returnSearch = params.get("returnTo");
  const selectedId = params.get("log") ?? "";
  const selectedAt = params.get("logAt") ?? "";
  const scope = JSON.stringify([
    filters.projectId,
    filters.environment,
    filters.q,
    filters.from,
    filters.to,
    filters.anchor,
    filters.anchorAt,
    filters.limit,
  ]);
  const cursors = pages.scope === scope ? pages.cursors : [undefined];
  const pageIndex = cursors.indexOf(filters.cursor);
  const query = useQuery({
    queryKey: ["logs", filters, TIME_SERIES_MAX_POINTS],
    queryFn: ({ signal }) => getLogs(filters, signal),
    enabled: ready,
    placeholderData: (previous, previousQuery) => {
      const old = previousQuery?.queryKey[1] as LogFilters | undefined;
      return old?.projectId === filters.projectId &&
        old?.q === filters.q &&
        old?.environment === filters.environment &&
        old?.anchor === filters.anchor &&
        old?.anchorAt === filters.anchorAt &&
        old?.limit === filters.limit
        ? previous
        : undefined;
    },
  });
  const detail = useQuery({
    queryKey: logDetailKey(filters.projectId, selectedId, selectedAt),
    queryFn: ({ signal }) => getLog(filters.projectId, selectedId, selectedAt, signal),
    enabled: ready && Boolean(selectedId),
    staleTime: Infinity,
    placeholderData: (previous) => (!selectedId ? previous : undefined),
  });
  const data = query.data;
  const selected = detail.data ?? null;
  const index = data?.items.findIndex((entry) => entry.eventId === selectedId) ?? -1;
  const changeQuery = (patch: Partial<LogFilters>) =>
    navigate({
      ...patch,
      cursor: undefined,
      log: undefined,
      logAt: undefined,
      anchor: undefined,
      anchorAt: undefined,
      direction: undefined,
    });
  const filterBy = (key: string, value: string, exclude = false) =>
    changeQuery({ q: withLogFilter(filters.q ?? "", key, value, exclude) });
  const openLog = (entry: LogEntry) => {
    client.setQueryData(logDetailKey(filters.projectId, entry.eventId, entry.timestamp), entry);
    navigate({ log: entry.eventId, logAt: entry.timestamp });
  };
  const rememberSearch = () => {
    if (returnSearch !== null) return returnSearch;
    const previous = new URLSearchParams(window.location.search);
    previous.delete("timePreset");
    previous.delete("returnTo");
    previous.set("from", filters.from);
    previous.set("to", filters.to);
    return previous.toString();
  };
  const related = (key: string, value: string) => {
    navigate(
      {
        returnTo: rememberSearch(),
        q: logSearchTerm(key, value),
        cursor: undefined,
        log: undefined,
        logAt: undefined,
        anchor: selected?.eventId,
        anchorAt: selected?.timestamp,
        direction: undefined,
      },
      { freeze: true },
    );
  };
  const selectRange = (range: { from: string; to: string }) => {
    navigate(
      {
        returnTo: rememberSearch(),
        ...range,
        cursor: undefined,
        log: undefined,
        logAt: undefined,
        anchor: undefined,
        anchorAt: undefined,
        direction: undefined,
      },
      { freeze: true },
    );
  };
  const nextPage = () => {
    if (!data?.nextCursor) return;
    const trail = pageIndex >= 0 ? cursors.slice(0, pageIndex + 1) : [undefined, filters.cursor];
    setPages({ scope, cursors: [...trail, data.nextCursor] });
    navigate(
      {
        cursor: data.nextCursor,
        direction: contextMode ? "after" : undefined,
        log: undefined,
        logAt: undefined,
      },
      { freeze: true },
    );
  };
  const hasSearch = Boolean(filters.q?.trim());
  const canExpandRange = Date.parse(filters.to) - Date.parse(filters.from) < 30 * 86400000;
  return (
    <ConsolePage width="fluid" className="[--page-gap:1rem]">
      <ConsolePageHeader title="日志" actions={<LogSearchHelp />} />
      <div className="min-w-0" aria-label="日志搜索">
        <LogFilterComposer
          filters={filters}
          items={data?.items}
          error={searchErrorFrom(query.error)}
          onChange={changeQuery}
        />
      </div>
      <ConsolePageContent className="grid gap-3">
        {returnSearch !== null ? (
          <div className="flex items-center gap-3 text-xs text-base-content/70">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                writeSearch(new URLSearchParams(returnSearch));
              }}
            >
              <ArrowLeftIcon />
              返回原搜索
            </Button>
          </div>
        ) : null}
        {query.isLoading || !ready ? (
          <div className="grid gap-3" aria-label="正在加载日志">
            <Skeleton className="h-48" />
            <Skeleton className="h-80" />
          </div>
        ) : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title="日志加载失败"
            remediation="筛选已保留；可检查搜索条件或缩短时间范围。"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {data && !query.error ? (
          <>
            {data.total > 0 ? (
              <LogTrend data={data} from={filters.from} to={filters.to} onRange={selectRange} />
            ) : null}
            <section
              className="card card-border min-w-0 bg-base-100"
              aria-label="日志结果"
              aria-busy={query.isFetching}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold">
                    日志列表{" "}
                    <span className="ml-2 font-normal tabular-nums text-base-content/70">
                      {data.total.toLocaleString()}
                    </span>
                  </h2>
                  {query.isFetching || contextMode ? (
                    <span role="status" className="text-xs text-base-content/70">
                      {query.isFetching ? "正在更新…" : "时间正序 · 关联前后文"}
                    </span>
                  ) : null}
                </div>
                {data.items.length ? (
                  <LogColumnPicker columns={columns} items={data.items} onChange={updateColumns} />
                ) : null}
              </div>
              {data.items.length ? (
                <>
                  {contextMode ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-2 text-xs">
                      <span className="text-base-content/70">
                        {data.items.some((entry) => entry.eventId === filters.anchor)
                          ? "原日志已标记，可继续查看前后记录。"
                          : filters.cursor
                            ? "正在查看关联日志，可返回原日志附近。"
                            : "原日志未出现在当前结果中，可能已超出筛选范围或保留期。"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={
                          query.isFetching ||
                          (!filters.cursor &&
                            !data.items.some((entry) => entry.eventId === filters.anchor))
                        }
                        onClick={() => {
                          navigate({
                            cursor: undefined,
                            direction: undefined,
                            log: undefined,
                            logAt: undefined,
                          });
                          setLocateVersion((value) => value + 1);
                        }}
                      >
                        定位原日志
                      </Button>
                    </div>
                  ) : null}
                  <LogTable
                    items={data.items}
                    query={filters.q ?? ""}
                    selectedId={selectedId}
                    anchorId={filters.anchor}
                    locationKey={`${filters.anchor}:${filters.cursor ?? ""}:${locateVersion}`}
                    columns={columns}
                    onOpen={openLog}
                    onFilter={filterBy}
                    onColumn={addColumn}
                    onRemoveColumn={(key) =>
                      updateColumns(columns.filter((column) => column !== key))
                    }
                  />
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-base-300 px-4 py-2" aria-label="日志分页">
                    <span className="text-xs tabular-nums text-base-content/70">
                      {!contextMode && pageIndex >= 0
                        ? `${(pageIndex * (filters.limit ?? 50) + 1).toLocaleString()}–${(pageIndex * (filters.limit ?? 50) + data.items.length).toLocaleString()} 条`
                        : `本页 ${data.items.length} 条`}
                    </span>
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(filters.limit ?? 50)}
                        disabled={query.isFetching}
                        onValueChange={(value) => {
                          setPages({ scope: "", cursors: [undefined] });
                          setLocateVersion((version) => version + 1);
                          navigate({
                            limit: Number(value),
                            cursor: undefined,
                            direction: undefined,
                            log: undefined,
                            logAt: undefined,
                          });
                        }}
                      >
                        <SelectTrigger size="sm" aria-label="每页条数" className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pageSizes.map((size) => (
                            <SelectItem key={size} value={String(size)}>{size} 条 / 页</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {filters.cursor && !contextMode ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={query.isFetching}
                          onClick={() => navigate({ cursor: undefined })}
                        >
                          回到最新
                        </Button>
                      ) : null}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-square"
                          aria-label={contextMode ? "更早日志" : "上一页"}
                          title={contextMode ? "更早日志" : "上一页"}
                          disabled={
                            (contextMode ? !data.previousCursor : pageIndex <= 0) ||
                            query.isFetching
                          }
                          onClick={() =>
                            navigate({
                              cursor: contextMode ? data.previousCursor : cursors[pageIndex - 1],
                              direction: contextMode ? "before" : undefined,
                              log: undefined,
                              logAt: undefined,
                            })
                          }
                        >
                          <ChevronLeftIcon className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-square"
                          aria-label={contextMode ? "更晚日志" : "下一页"}
                          title={contextMode ? "更晚日志" : "下一页"}
                          disabled={!data.nextCursor || query.isFetching}
                          onClick={nextPage}
                        >
                          <ChevronRightIcon className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-4">
                  <EmptyState
                    icon={FileTextIcon}
                    title={hasSearch ? "没有匹配当前条件的日志" : "当前时间范围没有日志"}
                    description={
                      hasSearch
                        ? "可清除搜索条件，或扩大时间范围后重试。"
                        : "当前时间和环境内没有可查询的日志，请检查分析范围和数据保留期。"
                    }
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        {hasSearch ? (
                          <Button variant="outline" onClick={() => changeQuery({ q: undefined })}>
                            清除搜索条件
                          </Button>
                        ) : null}
                        {canExpandRange ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              selectRange({
                                from: new Date(
                                  Date.parse(filters.to) - 30 * 86400000,
                                ).toISOString(),
                                to: filters.to,
                              })
                            }
                          >
                            扩大到 30 天
                          </Button>
                        ) : null}
                        {filters.cursor ? (
                          <Button variant="outline" onClick={() => navigate({ cursor: undefined })}>
                            回到最新
                          </Button>
                        ) : null}
                      </div>
                    }
                  />
                  {!hasSearch ? (
                    <details className="collapse collapse-arrow rounded-box border border-base-300">
                      <summary className="collapse-title min-h-0 py-3 text-xs">
                        日志接入说明
                      </summary>
                      <div className="collapse-content">
                        <div className="grid gap-3 text-xs">
                          <p className="text-base-content/70">
                            如尚未上报日志，可显式调用 logger，或单独配置 captureConsole。
                          </p>
                          <pre className="overflow-x-auto rounded-box bg-base-200 p-3 font-mono">
                            {'rum.logger.info("checkout started", { "order.id": "123" });'}
                          </pre>
                          <a
                            className="link w-fit"
                            href={`/projects/${filters.projectId}/onboarding`}
                          >
                            查看项目接入信息
                          </a>
                        </div>
                      </div>
                    </details>
                  ) : null}
                </div>
              )}
            </section>
          </>
        ) : null}
      </ConsolePageContent>
      <LogDetails
        entry={selected}
        open={Boolean(selectedId)}
        loading={detail.isPending}
        error={detail.error}
        projectId={filters.projectId}
        position={index >= 0 ? `${index + 1} / ${data?.items.length}` : undefined}
        previous={
          index > 0 && data && !query.isPlaceholderData
            ? () => openLog(data.items[index - 1])
            : undefined
        }
        next={
          index >= 0 && data && index < data.items.length - 1 && !query.isPlaceholderData
            ? () => openLog(data.items[index + 1])
            : undefined
        }
        onClose={() => navigate({ log: undefined, logAt: undefined })}
        onFilter={filterBy}
        onColumn={addColumn}
        columns={columns}
        query={filters.q}
        onRelated={related}
        onRetry={() => void detail.refetch()}
      />
    </ConsolePage>
  );
}

function LogSearchHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <CircleHelpIcon />
          搜索语法
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] text-xs leading-6">
        <h2 className="font-semibold">日志搜索</h2>
        <p>关键词匹配正文，区分大小写；多个条件同时满足。</p>
        <dl className="grid gap-1">
          <div>
            <code>level:[error,fatal]</code>
            <span className="ml-3 text-base-content/70">错误与致命日志</span>
          </div>
          <div>
            <code>!level:debug</code>
            <span className="ml-3 text-base-content/70">排除调试日志</span>
          </div>
          <div>
            <code>has:trace_id</code>
            <span className="ml-3 text-base-content/70">包含调用链标识</span>
          </div>
          <div>
            <code>attributes.error.code:*TIMEOUT*</code>
          </div>
        </dl>
        <p className="text-base-content/70">含空格的值用双引号包裹。不支持 OR 和括号。</p>
      </PopoverContent>
    </Popover>
  );
}

function writeSearch(params: URLSearchParams) {
  window.history.pushState({}, "", `${window.location.pathname}?${params}`);
  window.dispatchEvent(new Event("openrum:urlchange"));
}
function subscribeLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("openrum:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("openrum:urlchange", callback);
  };
}
