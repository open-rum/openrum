import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/features/analytics/format";
import { eventLabel } from "@/features/analytics/labels";
import { getBehaviorSamples, type BehaviorFilters, type BehaviorSample } from "@/lib/api/analytics";
import { getSessionTimeline } from "@/lib/api/issues";
import { sessionEventHref } from "@/lib/api/sessions";
import { BehaviorTimeline } from "./BehaviorTimeline";
import { attributePreview, kindLabel, sampleWindowLabel, shortID } from "./catalog";
import { sessionTimelineRange } from "./timeline";

export function EventSamples({ filters }: { filters: BehaviorFilters }) {
  const [selectedSample, setSelectedSample] = useState<BehaviorSample>();
  const hasSelectedEvent = Boolean(filters.eventKind || filters.eventName);
  // The previous event's rows must not linger under a new title, so this query keeps no
  // placeholder data: switching events shows a skeleton instead of stale samples.
  const samples = useQuery({
    queryKey: ["behavior-samples", filters],
    queryFn: ({ signal }) => getBehaviorSamples(filters, signal),
    enabled: hasSelectedEvent,
  });
  const limit = samples.data?.limit ?? 50;
  return (
    <section className="behavior-panel" aria-labelledby="event-samples-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="event-samples-title">原始样本</h2>
          <p>
            {hasSelectedEvent
              ? `${sampleWindowLabel(filters.from, filters.to)}最近至多 ${limit} 条脱敏样本，点击一行查看完整会话。`
              : "选择事件后，展示它最近的脱敏样本。"}
          </p>
        </div>
      </div>
      {!hasSelectedEvent ? (
        <EmptyState
          icon={MousePointerClickIcon}
          title="选择一个事件"
          description="从左侧事件目录选择后，可检查脱敏属性与前序行为时间线。"
        />
      ) : null}
      {samples.isLoading ? <Skeleton className="h-56" /> : null}
      {samples.error ? (
        <AsyncError
          error={samples.error}
          title="样本加载失败"
          remediation="样本查询最多支持 24 小时；请稍后重试。"
          onRetry={() => void samples.refetch()}
        />
      ) : null}
      {samples.data?.samples.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>页面 / 路由</TableHead>
              <TableHead>属性</TableHead>
              <TableHead>会话</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {samples.data.samples.map((sample) => {
              const preview = attributePreview(sample.attributes);
              const open = () => setSelectedSample(sample);
              return (
                <TableRow
                  key={sample.eventId}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={open}
                  onKeyDown={(key) => {
                    if (key.target !== key.currentTarget) return;
                    if (key.key === "Enter" || key.key === " ") {
                      key.preventDefault();
                      open();
                    }
                  }}
                >
                  <TableCell>
                    <strong title={new Date(sample.timestamp).toLocaleString("zh-CN")}>
                      {formatSampleAge(sample.timestamp)}
                    </strong>
                    <small>{new Date(sample.timestamp).toLocaleTimeString("zh-CN")}</small>
                  </TableCell>
                  <TableCell>
                    <strong>{sample.route || sample.pageUrl || "未知页面"}</strong>
                    <small>
                      {[sample.browser, sample.device, sample.country].filter(Boolean).join(" · ")}
                    </small>
                  </TableCell>
                  <TableCell>
                    {preview.shown.length ? (
                      <span className="event-chips">
                        {preview.shown.map(([key, value]) => (
                          <code key={key} title={`${key}=${value}`}>
                            {key}={value}
                          </code>
                        ))}
                        {preview.hidden ? <small>+{preview.hidden}</small> : null}
                      </span>
                    ) : (
                      <small>无属性</small>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="event-session">
                      <code>{shortID(sample.sessionId)}</code>
                      <CopyButton value={sample.sessionId} label="复制会话 ID" />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      {samples.data && !samples.data.samples.length ? (
        <EmptyState
          title="该时间窗口内没有原始样本"
          description="原始样本只保留一段时间。可以把时间范围调到更近，或确认该事件仍在上报。"
        />
      ) : null}
      {selectedSample ? (
        <SampleDetail
          projectId={filters.projectId}
          sample={selectedSample}
          onClose={() => setSelectedSample(undefined)}
        />
      ) : null}
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={async (click) => {
        click.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          toast.success("已复制");
        } catch {
          toast.error("复制失败，请手动选择文本");
        }
      }}
      onKeyDown={(key) => key.stopPropagation()}
    >
      <CopyIcon />
    </Button>
  );
}

function SampleDetail({
  projectId,
  sample,
  onClose,
}: {
  projectId: string;
  sample: BehaviorSample;
  onClose: () => void;
}) {
  const range = sessionTimelineRange(sample.timestamp);
  const timeline = useQuery({
    queryKey: ["session-timeline", projectId, sample.sessionId, range.from, range.to],
    queryFn: ({ signal }) =>
      getSessionTimeline(projectId, sample.sessionId, range.from, range.to, signal),
  });
  return (
    <Drawer open direction="right" onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="event-sample-detail w-[min(520px,calc(100vw-1rem))] sm:max-w-none">
        <DrawerHeader className="event-sample-detail__header">
          <div>
            <span>{kindLabel(sample.kind)}</span>
            <DrawerTitle>{eventLabel(sample.kind, sample.name)}</DrawerTitle>
            <DrawerDescription>
              {new Date(sample.timestamp).toLocaleString("zh-CN")}
            </DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label="关闭样本详情">
              <XIcon />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <dl className="event-sample-facts">
          <div>
            <dt>路由</dt>
            <dd>{sample.route || "—"}</dd>
          </div>
          <div>
            <dt>浏览器</dt>
            <dd>{sample.browser || "—"}</dd>
          </div>
          <div>
            <dt>设备</dt>
            <dd>{sample.device || "—"}</dd>
          </div>
          <div>
            <dt>国家</dt>
            <dd>{sample.country || "—"}</dd>
          </div>
          <div>
            <dt>会话</dt>
            <dd className="event-session">
              <code>{sample.sessionId}</code>
              <CopyButton value={sample.sessionId} label="复制完整会话 ID" />
            </dd>
          </div>
        </dl>
        {Object.keys(sample.attributes).length ? (
          <section>
            <h3>事件属性</h3>
            <dl className="event-sample-attributes">
              {Object.entries(sample.attributes).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        <section>
          <div className="event-sample-session-header">
            <div>
              <h3>完整会话时间线</h3>
              <p>页面、点击、自定义事件、API 与错误按发生顺序排列。</p>
            </div>
            {timeline.data ? <span>{timeline.data.events.length} 个事件</span> : null}
          </div>
          <Button asChild variant="outline" size="sm">
            <a
              href={sessionEventHref(projectId, sample.sessionId, sample.timestamp, sample.eventId)}
            >
              打开完整会话详情
            </a>
          </Button>
          {timeline.isLoading ? <Skeleton className="h-64" /> : null}
          {timeline.error ? (
            <AsyncError
              error={timeline.error}
              title="完整会话暂不可用"
              remediation="已保留事件随附的前序行为；可重新请求完整时间线。"
              onRetry={() => void timeline.refetch()}
            />
          ) : null}
          {!timeline.isLoading ? (
            <BehaviorTimeline
              breadcrumbs={sample.breadcrumbs}
              sessionTimeline={timeline.data}
              anchorEventId={sample.eventId}
              projectId={projectId}
              from={range.from.toISOString()}
              to={range.to.toISOString()}
            />
          ) : null}
        </section>
      </DrawerContent>
    </Drawer>
  );
}

function formatSampleAge(timestamp: string) {
  const seconds = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000);
  return formatRelative(seconds);
}
