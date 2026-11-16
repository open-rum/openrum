import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, CopyIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { BehaviorTimeline } from "@/features/events/BehaviorTimeline";
import { getSessionTimelinePage, sessionRange, type SessionSummary } from "@/lib/api/sessions";
import { SessionClientMeta } from "./SessionClientMeta";
import { sessionDetailHrefFromList } from "./sessionNavigation";
import { sessionPreviewEvents } from "./sessionPreviewEvents";

const previewEventLimit = 50;

export function SessionPreviewDrawer({
  projectId,
  session,
  open,
  onOpenChange,
}: {
  projectId: string;
  session?: SessionSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const range = session ? sessionRange(session) : undefined;
  const timeline = useQuery({
    queryKey: [
      "session-preview",
      projectId,
      session?.sessionId,
      range?.from,
      range?.to,
      previewEventLimit,
    ],
    queryFn: ({ signal }) =>
      getSessionTimelinePage(
        {
          projectId,
          sessionId: session!.sessionId,
          from: range!.from,
          to: range!.to,
          limit: previewEventLimit,
        },
        signal,
      ),
    enabled: open && Boolean(session && range),
  });
  const summary = timeline.data?.session ?? session;
  const scopeDiffers = Boolean(
    session &&
    summary &&
    (session.events !== summary.events || session.durationSeconds !== summary.durationSeconds),
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="session-preview-drawer sm:max-w-[520px]">
        <DrawerHeader className="session-preview-drawer__header">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle>
                {summary?.entryRoute || "会话预览"} → {summary?.exitRoute || "未知退出"}
              </DrawerTitle>
              <DrawerDescription className="truncate font-mono">
                会话 ID：{summary?.sessionId ?? "正在读取会话"}
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="关闭会话预览">
                <XIcon />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="session-preview-drawer__body">
          {summary ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{summary.environment || "未知环境"}</Badge>
                {summary.release ? <Badge variant="outline">{summary.release}</Badge> : null}
                {summary.errors ? <Badge variant="destructive">{summary.errors} 错误</Badge> : null}
                {summary.apiFailures ? (
                  <Badge variant="secondary">{summary.apiFailures} API 失败</Badge>
                ) : null}
              </div>
              <p className="text-sm text-base-content/70">
                预览按列表片段的起止时间查询已保留事件；列表与时间线可能因查询边界或数据可用性不同而有差异，完整详情也不保证包含已过期事件。
              </p>
              {scopeDiffers ? (
                <p role="status" className="alert alert-soft alert-info text-sm">
                  列表片段：{session?.events} 个事件 / {session?.durationSeconds} 秒；当前可查询：
                  {summary.events} 个事件 / {summary.durationSeconds} 秒。
                </p>
              ) : null}
              <dl className="session-preview-facts">
                <Fact
                  label="访客 ID"
                  value={
                    <span className="break-all font-mono">{summary.visitorId || "未采集"}</span>
                  }
                />
                <Fact
                  label="用户 ID"
                  value={<span className="break-all font-mono">{summary.userId || "未设置"}</span>}
                />
                <Fact
                  label="访问时间"
                  value={`${formatDateTime(summary.startedAt)} – ${formatTime(summary.endedAt)}`}
                />
                <Fact
                  label="访问路径"
                  value={`${summary.entryRoute || "未知入口"} → ${summary.exitRoute || summary.entryRoute || "未知退出"}`}
                />
                <Fact
                  label="设备"
                  value={
                    <SessionClientMeta
                      country={summary.country}
                      deviceType={summary.deviceType}
                      browser={summary.browser}
                      os={summary.os}
                    />
                  }
                />
                <Fact
                  label="事件构成"
                  value={`${summary.pageViews} 页面 · ${summary.customEvents} 自定义 · ${summary.events} 总事件`}
                />
                <Fact label="会话时长" value={formatDuration(summary.durationSeconds)} />
              </dl>
            </>
          ) : null}

          <section
            className="session-preview-timeline"
            aria-labelledby="session-preview-timeline-title"
          >
            <h3 id="session-preview-timeline-title">行为与异常预览</h3>
            <p className="text-xs text-base-content/70">
              从最初加载的最多 50 个已保留事件中，优先展示行为与异常，最多 6
              条。完整顺序与性能指标请查看详情。
            </p>
            {timeline.isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : null}
            {timeline.error ? (
              <AsyncError
                error={timeline.error}
                title="预览加载失败"
                remediation="会话摘要仍然可用，可打开完整详情后重试。"
                onRetry={() => void timeline.refetch()}
              />
            ) : null}
            {timeline.data ? (
              <BehaviorTimeline
                breadcrumbs={[]}
                sessionTimeline={{
                  ...timeline.data,
                  events: sessionPreviewEvents(timeline.data.events),
                  truncated: false,
                }}
                projectId={projectId}
                from={timeline.data.from}
                to={timeline.data.to}
              />
            ) : null}
          </section>
        </div>

        <DrawerFooter className="session-preview-drawer__footer">
          {summary ? (
            <Button asChild>
              <a href={sessionDetailHrefFromList(projectId, summary)}>
                查看完整详情
                <ArrowUpRightIcon data-icon="inline-end" />
              </a>
            </Button>
          ) : null}
          {summary ? (
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(summary.sessionId)}
            >
              <CopyIcon data-icon="inline-start" />
              复制会话 ID
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
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
