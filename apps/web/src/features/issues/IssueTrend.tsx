import { useState, type ReactNode } from "react";
import { timeAxis, valueAxis, VALUE_AXIS_MARGIN_TOP } from "@/lib/charts/axes";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import {
  bucketRows,
  chartTicks,
  intervalLabel,
  type TimeSeriesRange,
} from "@/lib/charts/timeSeries";
import { useChartWidth } from "@/lib/charts/useChartWidth";
import type { IssueDetailResponse } from "@/lib/api/issues";
import { formatIssueTrendTime, formatIssueTrendTooltip } from "./trendTime";
import { useBarRadiusTop } from "@/lib/charts/useBarRadius";

type Metric = "events" | "users";

const config = {
  events: { label: "错误事件", color: "var(--ds-chart-1)" },
  users: { label: "影响用户", color: "var(--ds-chart-1)" },
};

/**
 * Sentry-style trends strip: the event and user totals double as the series switch, a short
 * column chart sits in the middle, and the tag preview fills the right edge.
 */
export function IssueTrend({
  trend,
  range,
  totals,
  tags,
}: {
  trend: IssueDetailResponse["trend"];
  range: TimeSeriesRange;
  totals: { events: number; users: number };
  tags?: ReactNode;
}) {
  const barRadius = useBarRadiusTop();
  const animate = useChartMotion();
  const [metric, setMetric] = useState<Metric>("events");
  const data = bucketRows(trend, range);
  const { ref, width } = useChartWidth(data.length > 0);
  return (
    <section className="issue-panel issue-trend-strip" aria-label="趋势与标签">
      <div className="issue-trend-strip__stats" role="group" aria-label="趋势指标">
        {(
          [
            ["events", "事件", totals.events],
            ["users", "用户", totals.users],
          ] as const
        ).map(([key, label, value]) => (
          <button
            key={key}
            type="button"
            aria-pressed={metric === key}
            onClick={() => setMetric(key)}
          >
            <strong>{value.toLocaleString()}</strong>
            <span>{label}</span>
          </button>
        ))}
        {range.intervalSeconds ? (
          <small data-chart-interval={range.intervalSeconds}>
            每 {intervalLabel(range.intervalSeconds)}
          </small>
        ) : null}
      </div>
      <div className="issue-trend-strip__chart">
        {data.length ? (
          <ChartContainer
            ref={ref}
            config={config}
            className="aspect-auto h-[132px] w-full"
            aria-label={metric === "events" ? "错误事件趋势" : "影响用户趋势"}
          >
            <BarChart
              accessibilityLayer
              data={data}
              margin={{ top: VALUE_AXIS_MARGIN_TOP, right: 0, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              {/* Columns need a band axis; ticks still name actual bucket positions. */}
              <XAxis
                dataKey="timestamp"
                ticks={chartTicks(data, width).map((label) => Date.parse(label))}
                interval={0}
                {...timeAxis((value) => formatIssueTrendTime(Number(value)))}
              />
              <YAxis allowDecimals={false} tickCount={3} {...valueAxis()} />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={formatIssueTrendTooltip} />}
              />
              <Bar
                dataKey={metric}
                fill={`var(--color-${metric})`}
                radius={barRadius}
                maxBarSize={16}
                isAnimationActive={animate}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="issue-empty-copy">这个时间范围内没有趋势数据。</p>
        )}
      </div>
      {tags ? <div className="issue-trend-strip__tags">{tags}</div> : null}
    </section>
  );
}
