import { useMemo } from "react";
import { CategoryRanking } from "@/components/charts/CategoryRanking";
import { DonutDistribution } from "@/components/charts/DonutDistribution";
import { PlotChart } from "@/components/charts/PlotChart";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  behaviorBreakdownPlot,
  behaviorKindPlot,
  behaviorTrendPlot,
} from "@/features/analytics/plotData";
import { dimensionLabel, formatCompact } from "@/features/analytics/format";
import type {
  BehaviorAnalyticsResponse,
  BehaviorDimension,
  BehaviorKind,
} from "@/lib/api/analytics";
import { categoryColor } from "@/lib/charts/palette";
import { samplingNote } from "./catalog";
import { DimensionSelect } from "./DimensionSelect";

const rankedRows = 5;

/**
 * Three cards of one height above the list: how traffic moves, what kinds of event make it
 * up, and where it comes from. Every explanation lives behind an info icon in the card's
 * header, so the cards hold only the picture. The trend and the distribution follow the
 * page's filters; the event-type card reads the catalog, which covers every event in the
 * range. Which events lead is the list's job: it sorts by volume.
 */
export function EventSummary({
  data,
  dimension,
  onChangeDimension,
  onSelectKind,
}: {
  data: BehaviorAnalyticsResponse;
  dimension: BehaviorDimension;
  onChangeDimension: (dimension: BehaviorDimension) => void;
  onSelectKind: (kind: BehaviorKind) => void;
}) {
  const trend = useMemo(() => behaviorTrendPlot(data), [data]);
  const kinds = useMemo(() => behaviorKindPlot(data), [data]);
  const distribution = useMemo(() => behaviorBreakdownPlot(data, rankedRows), [data]);
  const { events, estimated, uniqueUsers, uniqueSessions } = data.totals;
  const sampling = samplingNote(events, estimated);
  const label = dimensionLabel(data.dimension);

  return (
    <div className="event-summary">
      <ChartCard
        className="event-summary__trend"
        id="event-trend-title"
        title="事件趋势"
        info={
          <>
            <p>次数与用户都是近似去重，各时间桶独立计算，不能相加作为总数。</p>
            {sampling ? <p>事件次数{sampling}。</p> : null}
            {trend.edgeNote ? <p>{trend.edgeNote}。</p> : null}
          </>
        }
        action={
          <dl className="event-totals" aria-label="核心指标">
            <Total color={categoryColor(0)} label="事件" value={events} />
            <Total color={categoryColor(1)} label="用户" value={uniqueUsers} />
            <Total label="会话" value={uniqueSessions} />
          </dl>
        }
      >
        <PlotChart data={trend} view="area" title="事件趋势" compact legend={false} />
      </ChartCard>

      <ChartCard
        id="event-kinds-title"
        title="事件类型"
        info={<p>全部事件的类型构成，不受事件筛选影响。点击一个类型，只看它。</p>}
      >
        <DonutDistribution
          compact
          data={kinds}
          title="事件类型"
          onSelect={(index) => {
            const key = kinds.rows[index]?.key;
            if (typeof key === "string") onSelectKind(key as BehaviorKind);
          }}
        />
      </ChartCard>

      <ChartCard
        id="event-distribution-title"
        title={`${label}分布`}
        info={
          <p>
            按事件次数排序的前 {Math.min(rankedRows, data.breakdown.length) || rankedRows}{" "}
            个。占比按已返回的分组合计计算。
          </p>
        }
        action={
          <DimensionSelect
            value={dimension}
            properties={data.properties}
            onChange={onChangeDimension}
          />
        }
      >
        <CategoryRanking compact data={distribution} title={`${label}分布`} />
      </ChartCard>
    </div>
  );
}

function Total({ color, label, value }: { color?: string; label: string; value: number }) {
  return (
    <div>
      <dt>
        {color ? <i style={{ background: color }} aria-hidden="true" /> : null}
        {label}
      </dt>
      <dd>{formatCompact(value)}</dd>
    </div>
  );
}
