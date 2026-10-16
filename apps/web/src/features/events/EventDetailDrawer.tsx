import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BracesIcon, XIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BehaviorMetric } from "@/features/analytics/BehaviorMetric";
import { CategoryRanking } from "@/components/charts/CategoryRanking";
import { PlotChart } from "@/components/charts/PlotChart";
import { behaviorBreakdownPlot, behaviorTrendPlot } from "@/features/analytics/plotData";
import { dimensionLabel, displayDimension, formatCompact } from "@/features/analytics/format";
import { eventLabel } from "@/features/analytics/labels";
import {
  getBehaviorAnalytics,
  type BehaviorAnalyticsResponse,
  type BehaviorDimension,
  type BehaviorFilters,
  type BehaviorKind,
  type BehaviorSample,
} from "@/lib/api/analytics";
import { TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";
import { kindLabel, samplingNote } from "./catalog";
import { DimensionSelect } from "./DimensionSelect";
import { EventSamples, SampleDetailBody } from "./EventSamples";

/**
 * Everything about one event in the page's time range: its own figures, trend, distribution,
 * measurements, properties and recent samples. It runs its own query, so opening an event
 * never changes the page's filters; "只看这个事件" is the explicit way to apply it.
 */
export function EventDetailDrawer({
  filters,
  kind,
  name,
  onClose,
  onFilter,
}: {
  filters: BehaviorFilters;
  kind: BehaviorKind;
  name: string;
  onClose: () => void;
  onFilter: (kind: BehaviorKind, name: string) => void;
}) {
  const [dimension, setDimension] = useState<BehaviorDimension>(filters.dimension);
  const [measurement, setMeasurement] = useState<string>();
  const [sample, setSample] = useState<BehaviorSample>();
  const scoped: BehaviorFilters = {
    ...filters,
    eventKind: kind,
    eventName: name,
    dimension,
    measurement,
  };
  const request = { ...scoped, maxPoints: TIME_SERIES_MAX_POINTS };
  const query = useQuery({
    queryKey: ["event-detail", request],
    queryFn: ({ signal }) => getBehaviorAnalytics(request, signal),
    // Switching the distribution keeps the figures on screen instead of blanking the drawer.
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const title = eventLabel(kind, name);

  return (
    <Drawer open direction="right" onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="event-detail-drawer data-[vaul-drawer-direction=right]:w-[min(760px,calc(100vw-1rem))] data-[vaul-drawer-direction=right]:sm:max-w-none">
        {sample ? (
          <div className="event-sample-detail event-sample-detail--embedded">
            <SampleDetailBody
              projectId={filters.projectId}
              sample={sample}
              onBack={() => setSample(undefined)}
              onClose={onClose}
            />
          </div>
        ) : (
          <>
            <DrawerHeader className="event-detail-drawer__header">
              <div>
                <span>{kindLabel(kind)}</span>
                <DrawerTitle>{title}</DrawerTitle>
                <DrawerDescription>
                  {filters.from.toLocaleString("zh-CN")} – {filters.to.toLocaleString("zh-CN")}
                </DrawerDescription>
              </div>
              <div className="event-detail-drawer__actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onFilter(kind, name);
                    onClose();
                  }}
                >
                  只看这个事件
                </Button>
                <Button variant="ghost" size="icon" aria-label="关闭事件详情" onClick={onClose}>
                  <XIcon />
                </Button>
              </div>
            </DrawerHeader>
            <div className="event-detail-drawer__scroll">
              {query.isLoading ? <Skeleton className="h-64" /> : null}
              {query.error ? (
                <AsyncError
                  error={query.error}
                  title="事件详情加载失败"
                  remediation="可以缩短时间范围后重试。"
                  onRetry={() => void query.refetch()}
                />
              ) : null}
              {data ? (
                <DetailContent
                  data={data}
                  dimension={dimension}
                  measurement={measurement}
                  onChangeDimension={setDimension}
                  onSelectMeasurement={setMeasurement}
                />
              ) : null}
              <EventSamples filters={scoped} onOpenSample={setSample} />
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function DetailContent({
  data,
  dimension,
  measurement,
  onChangeDimension,
  onSelectMeasurement,
}: {
  data: BehaviorAnalyticsResponse;
  dimension: BehaviorDimension;
  measurement?: string;
  onChangeDimension: (dimension: BehaviorDimension) => void;
  onSelectMeasurement: (name?: string) => void;
}) {
  const sampling = samplingNote(data.totals.events, data.totals.estimated);
  const activeProperty = dimension.startsWith("property:")
    ? dimension.slice("property:".length)
    : undefined;
  return (
    <>
      <section className="behavior-kpis behavior-kpis--three" aria-label="该事件的核心指标">
        <BehaviorMetric
          label="事件"
          value={formatCompact(data.totals.events)}
          note={
            sampling
              ? `${data.sampleCount.toLocaleString()} 个样本 · ${sampling}`
              : `${data.sampleCount.toLocaleString()} 个采集样本`
          }
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

      <section className="behavior-panel" aria-labelledby="detail-trend-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="detail-trend-title">趋势</h2>
            <p>该事件的次数与唯一用户</p>
          </div>
        </div>
        <div className="event-card-chart">
          <PlotChart data={behaviorTrendPlot(data)} view="area" title="趋势" showInterval />
        </div>
      </section>

      <section className="behavior-panel" aria-labelledby="detail-distribution-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="detail-distribution-title">{dimensionLabel(data.dimension)}分布</h2>
            <p>按次数排序的前 {Math.min(12, data.breakdown.length)} 个值</p>
          </div>
          <DimensionSelect
            value={dimension}
            properties={data.properties}
            onChange={onChangeDimension}
          />
        </div>
        {data.breakdown.length ? (
          <div className="event-card-chart">
            <CategoryRanking
              data={behaviorBreakdownPlot(data, 12)}
              title={`${dimensionLabel(data.dimension)}分布`}
              detailed
            />
          </div>
        ) : (
          <p className="behavior-empty-copy">这个事件在当前范围没有可展示的分布。</p>
        )}
      </section>

      {data.measurements.length ? (
        <Measurements data={data} selected={measurement} onSelect={onSelectMeasurement} />
      ) : null}

      <section className="behavior-panel" aria-labelledby="detail-properties-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="detail-properties-title">可分组属性</h2>
            <p>
              {activeProperty
                ? `分布正按 ${activeProperty} 拆分，再次点击取消。`
                : "点击一个属性，把上面的分布按它拆分。"}
            </p>
          </div>
        </div>
        {data.properties.length ? (
          <div className="event-properties">
            {data.properties.map((property) => (
              <button
                key={property.name}
                type="button"
                aria-pressed={property.name === activeProperty}
                onClick={() =>
                  onChangeDimension(
                    property.name === activeProperty ? "country" : `property:${property.name}`,
                  )
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
                {property.name === activeProperty ? <Badge variant="outline">分布中</Badge> : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="behavior-empty-copy">这个事件没有可用于分组的自定义属性。</p>
        )}
      </section>
    </>
  );
}

// Numeric Custom Event measurements. Hidden when the event carries none, so a Project that
// never sends them does not get an empty panel that reads as broken.
function Measurements({
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
    <section className="behavior-panel" aria-labelledby="detail-measurements-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="detail-measurements-title">数值指标</h2>
          <p>自定义事件 measurements 的汇总。点击一行，按{dimensionLabel(data.dimension)}拆分。</p>
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
