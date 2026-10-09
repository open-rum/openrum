import { BracesIcon, ListTreeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BehaviorMetric } from "@/features/analytics/BehaviorMetric";
import { BehaviorTrendChart } from "@/features/analytics/BehaviorTrendChart";
import {
  dimensionLabel,
  displayDimension,
  formatCompact,
  formatPercent,
  formatRelative,
} from "@/features/analytics/format";
import { eventLabel } from "@/features/analytics/labels";
import type { BehaviorAnalyticsResponse, BehaviorFilters, BehaviorKind } from "@/lib/api/analytics";
import { kindLabel } from "./catalog";
import { EventCatalog } from "./EventCatalog";
import { EventSamples } from "./EventSamples";

export function EventExplorer({
  data,
  filters,
  isFetching = false,
  onSelectEvent,
  onSelectProperty,
  onSelectMeasurement,
}: {
  data: BehaviorAnalyticsResponse;
  filters: BehaviorFilters;
  /** True while a refetch is in flight; the previous figures stay on screen, dimmed. */
  isFetching?: boolean;
  onSelectEvent: (kind?: BehaviorKind, name?: string) => void;
  /** Pass undefined to return to the default country breakdown. */
  onSelectProperty: (name?: string) => void;
  onSelectMeasurement: (name?: string) => void;
}) {
  if (!data.catalog.length && data.totals.events === 0) {
    return <NoEvents projectId={filters.projectId} />;
  }
  const activeProperty = filters.dimension.startsWith("property:")
    ? filters.dimension.slice("property:".length)
    : undefined;
  return (
    <div className="event-explorer" data-fetching={isFetching || undefined}>
      <EventCatalog
        catalog={data.catalog}
        selectedKind={filters.eventKind}
        selectedName={filters.eventName}
        onSelect={onSelectEvent}
        onClear={() => onSelectEvent()}
      />
      <div className="event-explorer__main">
        <div className="behavior-freshness" data-stale={data.freshness.stale || undefined}>
          {isFetching
            ? "正在更新…"
            : data.freshness.latestReceivedAt
              ? `数据更新于 ${formatRelative(data.freshness.ageSeconds)}`
              : "暂无新鲜度信息"}
          <span>统计为近似去重，采样估算已单独标记</span>
        </div>
        <section className="behavior-kpis" aria-label="所选事件的核心指标">
          <BehaviorMetric
            label="事件"
            value={formatCompact(data.totals.events)}
            note={`${data.sampleCount.toLocaleString()} 个采集样本`}
          />
          <BehaviorMetric
            label="估算事件"
            value={formatCompact(data.totals.estimated)}
            note="按事件采样率还原"
          />
          <BehaviorMetric
            label="用户"
            value={formatCompact(data.totals.uniqueUsers)}
            note="匿名用户近似去重"
          />
          <BehaviorMetric
            label="会话"
            value={formatCompact(data.totals.uniqueSessions)}
            note="会话 ID 近似去重"
          />
        </section>
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
        <div className={data.measurements.length ? "behavior-grid" : undefined}>
          <BreakdownPanel data={data} />
          {data.measurements.length ? (
            <MeasurementPanel
              data={data}
              selected={filters.measurement}
              onSelect={onSelectMeasurement}
            />
          ) : null}
        </div>
        <section className="behavior-panel" aria-labelledby="property-catalog-title">
          <div className="behavior-panel__header">
            <div>
              <h2 id="property-catalog-title">受控属性</h2>
              <p>服务端脱敏后可用于分群的属性键。再次点击可取消。</p>
            </div>
            {activeProperty ? (
              <Button variant="ghost" size="sm" onClick={() => onSelectProperty(undefined)}>
                恢复国家分布
              </Button>
            ) : null}
          </div>
          {data.properties.length ? (
            <div className="event-properties">
              {data.properties.map((property) => (
                <button
                  key={property.name}
                  type="button"
                  aria-pressed={property.name === activeProperty}
                  onClick={() =>
                    onSelectProperty(property.name === activeProperty ? undefined : property.name)
                  }
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
        <EventSamples filters={filters} />
      </div>
    </div>
  );
}

function NoEvents({ projectId }: { projectId: string }) {
  return (
    <section className="behavior-panel" aria-label="没有事件">
      <EmptyState
        icon={ListTreeIcon}
        title="当前范围没有事件"
        description="放宽时间范围或清除筛选后重试；如果项目还没有上报，先接入 SDK，或在本地用「造数据」生成一批。"
        action={
          <div className="event-empty-actions">
            <Button asChild variant="outline" size="sm">
              <a href={`/projects/${encodeURIComponent(projectId)}/onboarding`}>接入 SDK</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={`/projects/${encodeURIComponent(projectId)}/dev-data`}>造数据</a>
            </Button>
          </div>
        }
      />
    </section>
  );
}

function BreakdownPanel({ data }: { data: BehaviorAnalyticsResponse }) {
  if (!data.breakdown.length) return null;
  const label = dimensionLabel(data.dimension);
  const peak = Math.max(1, ...data.breakdown.map((item) => item.metric.events));
  return (
    <section className="behavior-panel" aria-labelledby="event-breakdown-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="event-breakdown-title">{label} 分布</h2>
          <p>
            按事件量排序的前 {Math.min(12, data.breakdown.length)}{" "}
            个值；通过筛选栏的「分群维度」切换。
          </p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            <TableHead>事件</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>占比</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.breakdown.slice(0, 12).map((item) => (
            <TableRow key={item.value}>
              <TableCell>
                <strong>{displayDimension(item.value, data.dimension)}</strong>
              </TableCell>
              <TableCell>
                {item.metric.events.toLocaleString()}
                <span className="event-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(2, (item.metric.events / peak) * 100)}%` }} />
                </span>
              </TableCell>
              <TableCell>{item.metric.uniqueUsers.toLocaleString()}</TableCell>
              <TableCell>{formatPercent(item.metric.events, data.totals.events)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

// Numeric Custom Event measurements. Hidden when the selection carries none, so a Project
// that never sends them does not get an empty panel that reads as broken.
function MeasurementPanel({
  data,
  selected,
  onSelect,
}: {
  data: BehaviorAnalyticsResponse;
  selected?: string;
  onSelect: (name?: string) => void;
}) {
  const breakdown = data.measurementBreakdown ?? [];
  return (
    <section className="behavior-panel" aria-labelledby="event-measurements-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="event-measurements-title">数值指标</h2>
          <p>自定义事件 measurements 的汇总。点击一行按{dimensionLabel(data.dimension)}拆分。</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>指标</TableHead>
            <TableHead>样本</TableHead>
            <TableHead>平均</TableHead>
            <TableHead>中位数</TableHead>
            <TableHead>P90</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.measurements.map((item) => {
            const toggle = () => onSelect(item.name === selected ? undefined : item.name);
            return (
              <TableRow
                key={item.name}
                tabIndex={0}
                aria-selected={item.name === selected}
                data-state={item.name === selected ? "selected" : undefined}
                className="cursor-pointer"
                onClick={toggle}
                onKeyDown={(key) => {
                  if (key.key === "Enter" || key.key === " ") {
                    key.preventDefault();
                    toggle();
                  }
                }}
              >
                <TableCell>
                  <strong>{item.name}</strong>
                </TableCell>
                <TableCell>{item.samples.toLocaleString()}</TableCell>
                <TableCell>{formatCompact(item.average)}</TableCell>
                <TableCell>{formatCompact(item.p50)}</TableCell>
                <TableCell>{formatCompact(item.p90)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {selected && breakdown.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {selected} · {dimensionLabel(data.dimension)}
              </TableHead>
              <TableHead>样本</TableHead>
              <TableHead>总和</TableHead>
              <TableHead>平均</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.slice(0, 12).map((row) => (
              <TableRow key={row.value}>
                <TableCell>
                  <strong>{displayDimension(row.value, data.dimension)}</strong>
                </TableCell>
                <TableCell>{row.samples.toLocaleString()}</TableCell>
                <TableCell>{formatCompact(row.total)}</TableCell>
                <TableCell>{formatCompact(row.average)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function selectedEventTitle(filters: BehaviorFilters) {
  return filters.eventName
    ? `${eventLabel(filters.eventKind ?? "custom", filters.eventName)}趋势`
    : filters.eventKind
      ? `${kindLabel(filters.eventKind)}趋势`
      : "全部事件趋势";
}
