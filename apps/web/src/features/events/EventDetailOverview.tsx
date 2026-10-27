import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import type { BehaviorAnalyticsResponse, BehaviorDimension } from "@/lib/api/analytics";
import { categoryColor } from "@/lib/charts/palette";
import { samplingNote } from "./catalog";
import { DimensionSelect } from "./DimensionSelect";

type Property = BehaviorAnalyticsResponse["properties"][number];

/** How many properties show before 展开全部; the rest are a click away. */
const visibleProperties = 6;

/**
 * One event at a glance: how often and by how many, its trend, what its properties carry,
 * where it happens and its measurements. Choosing a property value narrows the whole drawer.
 */
export function EventDetailOverview({
  data,
  dimension,
  measurement,
  chosen,
  onChangeDimension,
  onSelectMeasurement,
  onToggleValue,
}: {
  data: BehaviorAnalyticsResponse;
  dimension: BehaviorDimension;
  measurement?: string;
  /** Property values the drawer is narrowed to, as "name\u0000value". */
  chosen: ReadonlySet<string>;
  onChangeDimension: (dimension: BehaviorDimension) => void;
  onSelectMeasurement: (name?: string) => void;
  onToggleValue: (property: string, value: string) => void;
}) {
  const sampling = samplingNote(data.totals.events, data.totals.estimated);
  const perUser = data.totals.uniqueUsers ? data.totals.events / data.totals.uniqueUsers : 0;
  return (
    <>
      <section className="behavior-kpis" aria-label="该事件的核心指标">
        <BehaviorMetric
          label="次数"
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
        <BehaviorMetric
          label="人均次数"
          value={perUser ? perUser.toFixed(perUser < 10 ? 1 : 0) : "—"}
          note="次数 ÷ 用户"
        />
      </section>

      <section className="behavior-panel" aria-labelledby="detail-trend-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="detail-trend-title">趋势</h2>
            <p>该事件的次数与唯一用户</p>
          </div>
        </div>
        <div className="event-detail-chart">
          <PlotChart data={behaviorTrendPlot(data)} view="area" title="趋势" showInterval />
        </div>
      </section>

      <Properties
        properties={data.properties}
        dimension={dimension}
        chosen={chosen}
        onChangeDimension={onChangeDimension}
        onToggleValue={onToggleValue}
      />

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
          <div className="event-detail-ranking">
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
    </>
  );
}

/**
 * Each property with its most frequent values, drawn like the distribution below: name,
 * count and share on one line over a track scaled to the property's top value. A value
 * narrows the drawer to the events that carry it; 按此拆分 moves the distribution onto it.
 */
function Properties({
  properties,
  dimension,
  chosen,
  onChangeDimension,
  onToggleValue,
}: {
  properties: Property[];
  dimension: BehaviorDimension;
  chosen: ReadonlySet<string>;
  onChangeDimension: (dimension: BehaviorDimension) => void;
  onToggleValue: (property: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? properties : properties.slice(0, visibleProperties);
  return (
    <section className="behavior-panel" aria-labelledby="detail-properties-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="detail-properties-title">属性</h2>
          <p>每个属性最常见的取值。点击一个取值，只看带这个值的事件。</p>
        </div>
      </div>
      {properties.length ? (
        <div className="event-detail-properties">
          {shown.map((property) => {
            const split = dimension === `property:${property.name}`;
            const values = property.topValues ?? [];
            const top = values[0]?.events ?? 0;
            return (
              <div
                key={property.name}
                role="group"
                aria-label={`属性 ${property.name}`}
                className="event-detail-property"
              >
                <div className="event-detail-property__header">
                  <strong title={property.name}>{property.name}</strong>
                  <small>{property.cardinality.toLocaleString()} 个值</small>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-pressed={split}
                    onClick={() =>
                      onChangeDimension(split ? "country" : `property:${property.name}`)
                    }
                  >
                    {split ? "取消拆分" : "按此拆分"}
                  </Button>
                </div>
                {values.length ? (
                  <ul>
                    {values.map((item) => {
                      const share = property.events ? item.events / property.events : 0;
                      const pressed = chosen.has(`${property.name}\u0000${item.value}`);
                      return (
                        <li key={item.value}>
                          <button
                            type="button"
                            aria-pressed={pressed}
                            aria-label={`${pressed ? "取消只看" : "只看"} ${property.name} = ${item.value || "空值"}`}
                            onClick={() => onToggleValue(property.name, item.value)}
                          >
                            <span className="event-detail-property__row">
                              <span className="event-detail-property__value">
                                {item.value || <em>空值</em>}
                              </span>
                              <span className="event-detail-property__count">
                                {item.events.toLocaleString()}
                              </span>
                              <span className="event-detail-property__share">
                                {(share * 100).toFixed(1)}%
                              </span>
                            </span>
                            <span className="dashboard-ranking-track" aria-hidden="true">
                              <span
                                className="dashboard-ranking-fill"
                                style={{
                                  background: categoryColor(0),
                                  transform: `scaleX(${top ? item.events / top : 0})`,
                                }}
                              />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="behavior-empty-copy">
                    {property.events.toLocaleString()} 个事件带有这个属性。
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="behavior-empty-copy">这个事件没有可用于分组的自定义属性。</p>
      )}
      {properties.length > visibleProperties ? (
        <div className="event-detail-properties__more">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : `展开全部 ${properties.length} 个属性`}
          </Button>
        </div>
      ) : null}
    </section>
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
          <h2 id="detail-measurements-title">测量值</h2>
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
