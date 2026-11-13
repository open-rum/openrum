import { ArrowDownIcon, ArrowUpIcon, CopyIcon, LinkIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
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
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent className="logs-detail gap-0" showCloseButton={false}>
        <SheetHeader className="shrink-0 border-b border-base-300 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle>日志详情</SheetTitle>
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
        <div key={entry?.eventId ?? "pending"} className="min-h-0 flex-1 overflow-y-auto p-5">
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
            <div className="grid min-w-0 gap-5">
              <section className="grid gap-3" aria-label="日志正文">
                <div className="flex flex-wrap items-center gap-2">
                  <LogLevelBadge level={entry.level} />
                  <span className="text-xs text-base-content/70">{entry.logger || "应用日志"}</span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void copyText(entry.message)}>
                      <CopyIcon />
                      复制正文
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyText(logDetailLink(window.location.href, entry))}
                    >
                      <LinkIcon />
                      复制链接
                    </Button>
                  </div>
                </div>
                <pre className="rounded-box bg-base-200 p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
                  <LogMessage message={entry.message} query={query} />
                </pre>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/70">
                  <span>{entry.environment || "未指定环境"}</span>
                  <span>{entry.route || "未记录路由"}</span>
                  {entry.release ? <span>{entry.release}</span> : null}
                </div>
              </section>
              <section className="rounded-box border border-base-300 p-3" aria-label="关联日志">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">查看关联日志</h3>
                  <span className="text-[11px] text-base-content/70">
                    当前时间范围 · 按发生顺序查看
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRelated("session_id", entry.sessionId)}
                  >
                    同会话全部日志
                  </Button>
                  {entry.traceId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRelated("trace_id", entry.traceId)}
                    >
                      同 Trace 全部日志
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={sessionEventHref(
                        projectId,
                        entry.sessionId,
                        entry.timestamp,
                        entry.eventId,
                      )}
                    >
                      查看关联会话
                    </a>
                  </Button>
                </div>
              </section>
              <section className="grid gap-3" aria-label="结构化属性">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    结构化属性{" "}
                    <span className="ml-1 font-normal text-base-content/70">
                      {Object.keys(entry.attributes).length}
                    </span>
                  </h3>
                  <span className="text-[11px] text-base-content/70">筛选会追加到当前查询</span>
                </div>
                {Object.keys(entry.attributes).length ? (
                  <div className="overflow-x-auto rounded-box border border-base-300">
                    <table className="table table-sm w-full table-fixed">
                      <thead>
                        <tr>
                          <th className="w-[35%]">属性</th>
                          <th>值</th>
                          <th className="w-12">
                            <span className="sr-only">操作</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(entry.attributes).map(([key, value]) => (
                          <tr key={key}>
                            <td className="font-mono text-xs whitespace-normal break-all">{key}</td>
                            <td className="font-mono text-xs whitespace-pre-wrap break-all">
                              {value || "—"}
                            </td>
                            <td>
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
              </section>
              <details className="collapse collapse-arrow border border-base-300 rounded-box">
                <summary className="collapse-title min-h-0 py-3 text-sm font-semibold">
                  用户与访客{" "}
                  <span className="ml-2 text-xs font-normal text-base-content/70">
                    {entry.userId || "未设置用户 ID"}
                  </span>
                </summary>
                <div className="collapse-content">
                  <div className="grid gap-3 pt-1">
                    <LogFacts
                      values={{
                        "用户 ID": entry.userId || "未设置",
                        "匿名访客 ID": entry.anonymousUserId,
                      }}
                    />
                    <p className="text-xs text-base-content/70">日志产生时记录的身份。</p>
                    <div className="flex flex-wrap gap-2">
                      {entry.userId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRelated("user.id", entry.userId)}
                        >
                          同用户全部日志
                        </Button>
                      ) : null}
                      {entry.anonymousUserId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRelated("anonymous_user_id", entry.anonymousUserId)}
                        >
                          同访客全部日志
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </details>
              <details className="collapse collapse-arrow border border-base-300 rounded-box">
                <summary className="collapse-title min-h-0 py-3 text-sm font-semibold">
                  环境与追踪上下文
                </summary>
                <div className="collapse-content">
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
              <div>
                <Button
                  variant="ghost"
                  size="sm"
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
    <dl className="grid gap-2 text-xs">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[88px_minmax(0,1fr)_28px] items-start gap-2">
          <dt className="py-1 text-base-content/70">{key}</dt>
          <dd className="py-1 break-all">{value || "—"}</dd>
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
