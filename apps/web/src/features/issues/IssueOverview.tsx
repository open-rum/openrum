import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  BAR_RADIUS_TOP,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { countryLabel } from "@/features/filters/dimensionLabels";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { bucketRows, chartTicks, intervalLabel } from "@/lib/charts/timeSeries";
import { useChartWidth } from "@/lib/charts/useChartWidth";
import type { IssueOverviewResponse } from "@/lib/api/issues";
import { formatIssueTrendTime, formatIssueTrendTooltip } from "./trendTime";

type Series = "events" | "sessions" | "anonymousUsers";
type Distribution = "errorTypes" | "pages" | "countries";

const seriesLabels: Record<Series, string> = {
  events: "事件",
  sessions: "会话",
  anonymousUsers: "用户",
};
const config = {
  events: { label: "错误事件", color: "var(--ds-chart-1)" },
  sessions: { label: "影响会话", color: "var(--ds-chart-1)" },
  anonymousUsers: { label: "影响用户", color: "var(--ds-chart-1)" },
} satisfies ChartConfig;
const distributionLabels: Record<Distribution, string> = {
  errorTypes: "错误类型",
  pages: "页面",
  countries: "国家",
};

/**
 * One compact strip above the Issue list: a short column chart of the range (events, sessions
 * or users) beside a ranked breakdown (type, page or country). It replaces three tall charts
 * so the list the person acts on starts on the first screen.
 */
export function IssueOverview({ overview }: { overview: IssueOverviewResponse }) {
  const animate = useChartMotion();
  const [series, setSeries] = useState<Series>("events");
  const [dimension, setDimension] = useState<Distribution>("errorTypes");
  const data = useMemo(() => bucketRows(overview.trend, overview), [overview]);
  const { ref, width } = useChartWidth(data.length > 0);
  const totalEvents = overview.trend.reduce((total, point) => total + point.events, 0);
  const ranking = useMemo(() => {
    const items = overview[dimension].slice(0, 5);
    const peak = Math.max(1, ...items.map((item) => item.events));
    return items.map((item) => ({
      label: rankingLabel(dimension, item.value),
      events: item.events,
      width: (item.events / peak) * 100,
      share: totalEvents ? item.events / totalEvents : 0,
    }));
  }, [dimension, overview, totalEvents]);

  return (
    <section className="issue-overview" aria-label="错误概览">
      <div className="issue-overview__trend">
        <div className="issue-overview__head">
          <div className="issue-overview__total">
            <strong>{totalEvents.toLocaleString()}</strong>
            <span>事件</span>
          </div>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={series}
            aria-label="切换趋势指标"
            onValueChange={(value) => value && setSeries(value as Series)}
          >
            {(Object.keys(seriesLabels) as Series[]).map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {seriesLabels[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {data.length ? (
          <ChartContainer
            ref={ref}
            config={config}
            className="aspect-auto h-[108px] w-full"
            role="img"
            aria-label={`${seriesLabels[series]}趋势`}
            data-chart-interval={overview.intervalSeconds}
            title={
              overview.intervalSeconds ? `每 ${intervalLabel(overview.intervalSeconds)}` : undefined
            }
          >
            <BarChart
              accessibilityLayer
              data={data}
              margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timestamp"
                ticks={chartTicks(data, width).map((label) => Date.parse(label))}
                interval={0}
                tickFormatter={formatIssueTrendTime}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={36}
                tickCount={3}
                axisLine={false}
                tickLine={false}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent labelFormatter={formatIssueTrendTooltip} />}
              />
              <Bar
                dataKey={series}
                fill={`var(--color-${series})`}
                radius={BAR_RADIUS_TOP}
                maxBarSize={14}
                isAnimationActive={animate}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="issue-overview__empty">当前范围暂无错误数据</p>
        )}
      </div>
      <div className="issue-overview__ranking">
        <div className="issue-overview__head">
          <h2>错误分布</h2>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={dimension}
            aria-label="切换错误分布维度"
            onValueChange={(value) => value && setDimension(value as Distribution)}
          >
            {(Object.keys(distributionLabels) as Distribution[]).map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {distributionLabels[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {ranking.length ? (
          <ol aria-label={`按${distributionLabels[dimension]}的错误占比`}>
            {ranking.map((item) => (
              <li key={item.label}>
                <span className="issue-overview__label" title={item.label}>
                  {item.label}
                </span>
                <span className="issue-overview__bar" aria-hidden="true">
                  <i style={{ width: `${item.width}%` }} />
                </span>
                <span className="issue-overview__share">{formatShare(item.share)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="issue-overview__empty">暂无分布数据</p>
        )}
      </div>
    </section>
  );
}

function rankingLabel(dimension: Distribution, value: string) {
  if (value === "unknown")
    return dimension === "countries" ? "未知国家" : dimension === "pages" ? "未知页面" : "未知异常";
  return dimension === "countries" ? countryLabel(value) : value;
}

function formatShare(share: number) {
  const percent = share * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}
