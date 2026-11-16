import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  CopyIcon,
  LinkIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AsyncError } from "@/components/ui/AsyncState";
import { Skeleton } from "@/components/ui/skeleton";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import type { LogEntry } from "@/lib/api/logs";
import { sessionEventHref } from "@/lib/api/sessions";
import { logDetailLink, logTime } from "./logNavigation";
import { LogMessage } from "./LogMessage";
import { LogFieldActions, type LogFieldCallbacks } from "./LogFieldActions";
import { validLogAttribute } from "./logPresentation";

async function copyText(value: string) {
  try {
    if (!navigator.clipboard) throw new Error("unavailable");
    await navigator.clipboard.writeText(value);
    toast.success("已复制");
  } catch {
    toast.error("复制失败，请检查剪贴板权限。");
  }
}

export function LogDetails({
  entry,
  open,
  loading,
  error,
  projectId,
  position,
  previous,
  next,
  onClose,
  onFilter,
  onColumn,
  columns,
  query,
  onRelated,
  onRetry,
}: {
  entry: LogEntry | null;
  open: boolean;
  loading: boolean;
  error: Error | null;
  projectId: string;
  position?: string;
  previous?: () => void;
  next?: () => void;
  onClose: () => void;
  query?: string;
  onRelated: (key: string, value: string) => void;
  onRetry: () => void;
} & LogFieldCallbacks) {
  const [attributeView, setAttributeView] = useState("fields");

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent className="logs-detail gap-0" showCloseButton={false}>
        <SheetHeader className="shrink-0 border-b border-base-300 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-base font-semibold">日志详情</SheetTitle>
              <SheetDescription className="mt-1 font-mono text-xs text-base-content/70">
                {entry ? logTime(entry.timestamp, true) : "日志正文与关联上下文"}
              </SheetDescription>
            </div>
            <div className="flex items-center gap-1">
              {position ? (
                <span className="mr-2 text-xs text-base-content/70">{position}</span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="上一条日志"
                title="上一条日志"
                disabled={!previous}
                onClick={previous}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="下一条日志"
                title="下一条日志"
                disabled={!next}
                onClick={next}
              >
                <ArrowDownIcon />
              </Button>
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="关闭日志详情">
                  <XIcon />
                </Button>
              </SheetClose>
            </div>
          </div>
        </SheetHeader>
        <div
          key={entry?.eventId ?? "pending"}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        >
          {loading && !entry ? (
            <div className="grid gap-4" aria-label="正在加载日志详情">
              <Skeleton className="h-24" />
              <Skeleton className="h-48" />
            </div>
          ) : null}
          {error ? (
            <AsyncError
              error={error}
              title="日志详情加载失败"
              remediation="可重试加载，或关闭详情后重新选择日志。"
              onRetry={onRetry}
            />
          ) : null}
          {!loading && !error && !entry ? (
            <div className="grid gap-3 py-8 text-sm">
              <h3 className="font-semibold">未找到这条日志</h3>
              <p className="text-base-content/70">
                日志可能已超过保留期，或链接中的时间与日志不符。
              </p>
              <Button variant="outline" onClick={onClose}>
                返回日志列表
              </Button>
            </div>
          ) : null}
          {entry ? (
            <div className="grid min-w-0 gap-7">
              <section className="grid gap-3" aria-label="日志正文">
                <div className="flex flex-wrap items-center gap-2">
                  <LogLevelBadge level={entry.level} />
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-base-content/70"
                    title={entry.logger || "应用日志"}
                  >
                    {entry.logger || "应用日志"}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="复制正文"
                      title="复制正文"
                      className="text-base-content/70"
                      onClick={() => void copyText(entry.message)}
                    >
                      <CopyIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="复制链接"
                      title="复制链接"
                      className="text-base-content/70"
                      onClick={() => void copyText(logDetailLink(window.location.href, entry))}
                    >
                      <LinkIcon />
                    </Button>
                  </div>
                </div>
                <pre className="min-w-0 rounded-box bg-base-200/70 p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <LogMessage message={entry.message} query={query} />
                </pre>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
                  {[
                    ["环境", entry.environment || "未指定"],
                    ["路由", entry.route || "未记录"],
                    ["版本", entry.release || "未记录"],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 space-y-1">
                      <dt className="text-base-content/70">{label}</dt>
                      <dd className="break-all leading-5">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-label="结构化属性">
                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">
                      结构化属性{" "}
                      <span className="ml-1 font-normal text-base-content/70">
                        {Object.keys(entry.attributes).length}
                      </span>
                    </h3>
                    <ToggleGroup
                      type="single"
                      variant="segmented"
                      color="neutral"
                      size="sm"
                      aria-label="属性视图"
                      value={attributeView}
                      onValueChange={(value) => {
                        if (value) setAttributeView(value);
                      }}
                    >
                      <ToggleGroupItem value="fields">列表</ToggleGroupItem>
                      <ToggleGroupItem value="json">JSON</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  {attributeView === "fields" ? (
                    <div role="region" aria-label="属性列表">
                      {Object.keys(entry.attributes).length ? (
                        <div className="min-w-0">
                          <table className="table table-sm w-full table-fixed">
                            <colgroup>
                              <col className="w-[40%]" />
                              <col />
                              <col className="w-9" />
                            </colgroup>
                            <thead className="sr-only">
                              <tr>
                                <th>属性</th>
                                <th>值</th>
                                <th>
                                  <span className="sr-only">操作</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(entry.attributes).map(([key, value]) => (
                                <tr key={key} className="hover:bg-base-200/50">
                                  <td className="py-3 pl-0 font-mono text-xs leading-5 whitespace-normal break-all text-base-content/70">
                                    {key}
                                  </td>
                                  <td className="py-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
                                    {value || "—"}
                                  </td>
                                  <td className="pr-0 text-right">
                                    <LogFieldActions
                                      field={`attributes.${key}`}
                                      label={key}
                                      value={value}
                                      filterable={validLogAttribute(key)}
                                      onFilter={onFilter}
                                      onColumn={onColumn}
                                      columns={columns}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-base-content/70">此日志没有附加属性。</p>
                      )}
                    </div>
                  ) : (
                    <div role="region" aria-label="属性 JSON 视图">
                      <div className="relative min-w-0 rounded-box bg-base-200/70">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="absolute top-2 right-2 text-base-content/70"
                          aria-label="复制属性 JSON"
                          title="复制属性 JSON"
                          onClick={() => void copyText(JSON.stringify(entry.attributes, null, 2))}
                        >
                          <CopyIcon />
                        </Button>
                        <pre
                          aria-label="属性 JSON"
                          className="p-4 pr-12 font-mono text-xs leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]"
                        >
                          <code>{JSON.stringify(entry.attributes, null, 2)}</code>
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </section>
              <section className="grid gap-2" aria-label="关联日志">
                <h3 className="text-sm font-semibold">关联日志</h3>
                <div className="-ml-2 flex flex-wrap gap-x-3 gap-y-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2 text-xs"
                    onClick={() => onRelated("session_id", entry.sessionId)}
                  >
                    同会话全部日志 <ArrowUpRightIcon />
                  </Button>
                  {entry.traceId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2 text-xs"
                      onClick={() => onRelated("trace_id", entry.traceId)}
                    >
                      同 Trace 全部日志 <ArrowUpRightIcon />
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="sm" className="px-2 text-xs">
                    <a
                      href={sessionEventHref(
                        projectId,
                        entry.sessionId,
                        entry.timestamp,
                        entry.eventId,
                      )}
                    >
                      查看关联会话 <ArrowUpRightIcon />
                    </a>
                  </Button>
                </div>
              </section>
              <div className="divide-y divide-base-300 border-y border-base-300">
                <details className="collapse collapse-arrow rounded-none">
                  <summary className="collapse-title min-h-0 py-4 pl-0 text-sm font-medium after:end-1">
                    用户与访客{" "}
                    <span className="mt-1 block break-all text-xs font-normal text-base-content/70">
                      {entry.userId || "未设置用户 ID"}
                    </span>
                  </summary>
                  <div className="collapse-content px-0">
                    <div className="grid gap-3 pt-1">
                      <LogFacts
                        values={{
                          "用户 ID": entry.userId || "未设置",
                          "匿名访客 ID": entry.anonymousUserId,
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        {entry.userId ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2 text-xs"
                            onClick={() => onRelated("user.id", entry.userId)}
                          >
                            同用户全部日志
                          </Button>
                        ) : null}
                        {entry.anonymousUserId ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2 text-xs"
                            onClick={() => onRelated("anonymous_user_id", entry.anonymousUserId)}
                          >
                            同访客全部日志
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </details>
                <details className="collapse collapse-arrow rounded-none">
                  <summary className="collapse-title min-h-0 py-4 pl-0 text-sm font-medium after:end-1">
                    环境与追踪上下文
                  </summary>
                  <div className="collapse-content px-0">
                    <div className="pt-1">
                      <LogFacts
                        values={{
                          "日志 ID": entry.eventId,
                          环境: entry.environment,
                          版本: entry.release,
                          页面: entry.pageUrl,
                          路由: entry.route,
                          浏览器: entry.browser,
                          设备: deviceLabel(entry.deviceType),
                          "国家 / 地区": countryLabel(entry.country),
                          "Session ID": entry.sessionId,
                          "Trace ID": entry.traceId,
                          "Span ID": entry.spanId,
                          采样率: `${Math.round(entry.sampleRate * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </details>
              </div>
              <div className="-mt-3 -ml-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 text-xs text-base-content/70"
                  onClick={() => void copyText(JSON.stringify(entry, null, 2))}
                >
                  <CopyIcon />
                  复制完整 JSON
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LogFacts({ values }: { values: Record<string, string> }) {
  return (
    <dl className="grid gap-1 text-xs">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[88px_minmax(0,1fr)_32px] items-start gap-3 py-1">
          <dt className="py-1 text-base-content/70">{key}</dt>
          <dd className="py-1 font-mono leading-5 break-all">{value || "—"}</dd>
          {value ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`复制 ${key}`}
              title={`复制 ${key}`}
              onClick={() => void copyText(value)}
            >
              <CopyIcon />
            </Button>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export function LogLevelBadge({ level }: { level: LogEntry["level"] }) {
  return (
    <Badge
      variant={
        level === "error" || level === "fatal"
          ? "destructive"
          : level === "warn"
            ? "warning"
            : "secondary"
      }
      className="font-mono text-[10px]"
    >
      {level.toUpperCase()}
    </Badge>
  );
}
