import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BracesIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
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
import { BehaviorTrendChart } from "@/features/analytics/BehaviorTrendChart";
import { eventLabel } from "@/features/analytics/labels";
import {
  getBehaviorSamples,
  type BehaviorAnalyticsResponse,
  type BehaviorFilters,
  type BehaviorKind,
  type BehaviorSample,
} from "@/lib/api/analytics";
import { getSessionTimeline } from "@/lib/api/issues";
import { BehaviorTimeline } from "./BehaviorTimeline";
import { sessionTimelineRange } from "./timeline";

export function EventExplorer({
  data,
  filters,
  onSelectEvent,
  onSelectProperty,
}: {
  data: BehaviorAnalyticsResponse;
  filters: BehaviorFilters;
  onSelectEvent: (kind?: BehaviorKind, name?: string) => void;
  onSelectProperty: (name: string) => void;
}) {
  const [selectedSample, setSelectedSample] = useState<BehaviorSample>();
  const hasSelectedEvent = Boolean(filters.eventKind || filters.eventName);
  const samples = useQuery({
    queryKey: ["behavior-samples", filters],
    queryFn: ({ signal }) => getBehaviorSamples(filters, signal),
    enabled: hasSelectedEvent,
  });
  return (
    <div className="event-explorer">
      <section className="behavior-panel event-catalog" aria-labelledby="event-catalog-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="event-catalog-title">事件目录</h2>
            <p>{data.catalog.length} 个活跃事件</p>
          </div>
          {hasSelectedEvent ? (
            <Button variant="ghost" size="sm" onClick={() => onSelectEvent()}>
              清除筛选
            </Button>
          ) : null}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>事件</TableHead>
              <TableHead>次数</TableHead>
              <TableHead>用户</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.catalog.map((event) => {
              const selected = event.kind === filters.eventKind && event.name === filters.eventName;
              return (
                <TableRow
                  key={`${event.kind}:${event.name}`}
                  tabIndex={0}
                  data-state={selected ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onSelectEvent(event.kind as BehaviorKind, event.name)}
                  onKeyDown={(key) => {
                    if (key.key === "Enter") onSelectEvent(event.kind as BehaviorKind, event.name);
                  }}
                >
                  <TableCell>
                    <strong>{eventLabel(event.kind, event.name)}</strong>
                    <small>{kindLabel(event.kind)}</small>
                  </TableCell>
                  <TableCell>{event.metric.events.toLocaleString()}</TableCell>
                  <TableCell>{event.metric.uniqueUsers.toLocaleString()}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <div className="event-explorer__main">
        <section
          className="behavior-panel behavior-panel--chart"
          aria-labelledby="event-trend-title"
        >
          <div className="behavior-panel__header">
            <div>
              <h2 id="event-trend-title">{selectedEventTitle(filters)}</h2>
              <p>事件次数与唯一用户趋势，统计口径为近似去重。</p>
            </div>
            <Badge variant="outline">{data.sampleCount.toLocaleString()} 样本</Badge>
          </div>
          <BehaviorTrendChart data={data.trend} />
        </section>
        <section className="behavior-panel" aria-labelledby="property-catalog-title">
          <div className="behavior-panel__header">
            <div>
              <h2 id="property-catalog-title">受控属性</h2>
              <p>服务端脱敏后可用于分群的属性键。</p>
            </div>
          </div>
          {data.properties.length ? (
            <div className="event-properties">
              {data.properties.map((property) => (
                <button
                  key={property.name}
                  type="button"
                  onClick={() => onSelectProperty(property.name)}
                >
                  <BracesIcon />
                  <span>
                    <strong>{property.name}</strong>
                    <small>
                      {property.events.toLocaleString()} 事件 ·{" "}
                      {property.cardinality.toLocaleString()} 个值
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="behavior-empty-copy">当前事件没有可用于分群的自定义属性。</p>
          )}
        </section>
        <section className="behavior-panel" aria-labelledby="event-samples-title">
          <div className="behavior-panel__header">
            <div>
              <h2 id="event-samples-title">原始样本</h2>
              <p>为控制扫描成本，仅展示选中事件最近 24 小时的 50 条样本。</p>
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
                  <TableHead>环境</TableHead>
                  <TableHead>会话</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {samples.data.samples.map((sample) => (
                  <TableRow
                    key={sample.eventId}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => setSelectedSample(sample)}
                    onKeyDown={(key) => {
                      if (key.key === "Enter") setSelectedSample(sample);
                    }}
                  >
                    <TableCell>{new Date(sample.timestamp).toLocaleString("zh-CN")}</TableCell>
                    <TableCell>
                      <strong>{sample.route || sample.pageUrl || "未知页面"}</strong>
                      <small>
                        {sample.browser} · {sample.device} · {sample.country}
                      </small>
                    </TableCell>
                    <TableCell>
                      {Object.keys(sample.attributes).length
                        ? `${Object.keys(sample.attributes).length} 个属性`
                        : "无属性"}
                    </TableCell>
                    <TableCell>
                      <code>{shortID(sample.sessionId)}</code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          {samples.data && !samples.data.samples.length ? (
            <p className="behavior-empty-copy">最近 24 小时没有该事件的原始样本。</p>
          ) : null}
        </section>
      </div>
      {selectedSample ? (
        <SampleDetail
          projectId={filters.projectId}
          sample={selectedSample}
          onClose={() => setSelectedSample(undefined)}
        />
      ) : null}
    </div>
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
            <dd>
              <code>{sample.sessionId}</code>
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

function selectedEventTitle(filters: BehaviorFilters) {
  return filters.eventName
    ? `${eventLabel(filters.eventKind ?? "custom", filters.eventName)}趋势`
    : filters.eventKind
      ? `${kindLabel(filters.eventKind)}趋势`
      : "全部事件趋势";
}
function kindLabel(value: string) {
  return (
    (
      {
        page_view: "页面访问",
        navigation: "页面导航",
        click: "元素点击",
        custom: "自定义事件",
      } as Record<string, string>
    )[value] ?? value
  );
}
function shortID(value: string) {
  return `${value.slice(0, 8)}…`;
}
