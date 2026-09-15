import { CopyIcon, FilterIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import type { LogEntry } from "@/lib/api/logs";
import { sessionEventHref } from "@/lib/api/sessions";

export function LogDetails({
  entry,
  projectId,
  onClose,
  onFilter,
}: {
  entry: LogEntry | null;
  projectId: string;
  from: string;
  to: string;
  onClose: () => void;
  onFilter: (key: string, value: string) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  return (
    <Sheet
      open={Boolean(entry)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="logs-detail">
        <SheetHeader>
          <SheetTitle>日志详情</SheetTitle>
          <SheetDescription>
            {entry ? new Date(entry.timestamp).toLocaleString("zh-CN") : "结构化日志和关联上下文"}
          </SheetDescription>
        </SheetHeader>
        {entry ? (
          <div className="logs-detail-body">
            <div className="flex flex-wrap items-center gap-2">
              <LogLevelBadge level={entry.level} />
              <span className="text-xs text-muted-foreground">{entry.logger || "应用日志"}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!navigator.clipboard) {
                    setCopyStatus("当前环境不支持复制");
                    return;
                  }
                  void navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).then(
                    () => setCopyStatus("已复制"),
                    () => setCopyStatus("复制失败，请检查剪贴板权限"),
                  );
                }}
              >
                <CopyIcon data-icon="inline-start" />
                复制 JSON
              </Button>
              <span role="status" className="text-xs text-muted-foreground">
                {copyStatus}
              </span>
            </div>
            <pre className="logs-message-full">{entry.message}</pre>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => onFilter("session_id", entry.sessionId)}
              >
                同会话日志
              </Button>
              {entry.traceId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onFilter("trace_id", entry.traceId)}
                >
                  同 Trace 日志
                </Button>
              ) : null}
            </div>
            <section className="grid gap-3" aria-labelledby="log-user-heading">
              <h3 id="log-user-heading">用户信息</h3>
              <dl className="logs-context">
                <div>
                  <dt>用户 ID</dt>
                  <dd>{entry.userId || "未设置"}</dd>
                </div>
                <div>
                  <dt>匿名访客 ID</dt>
                  <dd>{entry.anonymousUserId || "—"}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                日志产生时的身份；未设置用户 ID 时，可按匿名访客排查。
              </p>
              <div className="flex flex-wrap gap-2">
                {entry.userId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onFilter("user.id", entry.userId)}
                  >
                    <FilterIcon data-icon="inline-start" />
                    同用户日志
                  </Button>
                ) : null}
                {entry.anonymousUserId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onFilter("anonymous_user_id", entry.anonymousUserId)}
                  >
                    <FilterIcon data-icon="inline-start" />
                    同访客日志
                  </Button>
                ) : null}
              </div>
            </section>
            <section className="grid gap-3">
              <h3>上下文</h3>
              <dl className="logs-context">
                {Object.entries({
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
                }).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="grid gap-3">
              <h3>
                结构化属性{" "}
                <span className="text-muted-foreground">
                  {Object.keys(entry.attributes).length}
                </span>
              </h3>
              {Object.keys(entry.attributes).length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>属性</TableHead>
                      <TableHead>值</TableHead>
                      <TableHead>
                        <span className="sr-only">操作</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(entry.attributes).map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="font-mono">{key}</TableCell>
                        <TableCell className="whitespace-normal break-all">{value}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`按 ${key} 筛选`}
                            disabled={!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || !value}
                            onClick={() => onFilter(`attributes.${key}`, value)}
                          >
                            <FilterIcon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">此日志没有附加属性。</p>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function LogLevelBadge({ level }: { level: LogEntry["level"] }) {
  return (
    <Badge
      variant={level === "error" || level === "fatal" ? "destructive" : "outline"}
      className="logs-level"
      data-level={level}
    >
      {level.toUpperCase()}
    </Badge>
  );
}
