import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import type { IssueDetailResponse } from "@/lib/api/issues";
import { formatIssueTrendTime, formatIssueTrendTooltip } from "./trendTime";

const config = {
  events: { label: "错误事件", color: "var(--ds-chart-1)" },
  users: { label: "影响用户", color: "var(--ds-chart-2)" },
};

export function IssueTrend({ trend }: { trend: IssueDetailResponse["trend"] }) {
  const animate = useChartMotion();
  const data = trend.map((point) => ({ ...point, timestamp: new Date(point.bucket).getTime() }));
  return (
    <section className="issue-panel issue-trend" aria-labelledby="issue-trend-title">
      <div className="issue-panel__header">
        <div>
          <h2 id="issue-trend-title">发生趋势</h2>
          <p>每个时间桶的错误事件与去重用户，帮助定位异常时段。</p>
        </div>
      </div>
      {data.length ? (
        <>
          <div className="issue-chart-legend mt-4">
            <span>
              <i />
              错误事件
            </span>
            <span>
              <i />
              影响用户
            </span>
          </div>
          <ChartContainer
            config={config}
            className="h-60 w-full aspect-auto pr-4"
            aria-label="错误事件与影响用户趋势"
          >
            <LineChart
              accessibilityLayer
              data={data}
              margin={{ top: 10, right: 12, bottom: 4, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                ticks={data
                  .filter(
                    (_, index) =>
                      index % Math.max(1, Math.ceil(data.length / 6)) === 0 ||
                      index === data.length - 1,
                  )
                  .map((point) => point.timestamp)}
                tickFormatter={formatIssueTrendTime}
                minTickGap={48}
                axisLine={false}
                tickLine={false}
              />
              <YAxis allowDecimals={false} width={48} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={formatIssueTrendTooltip} />}
              />
              <Line
                type="linear"
                dataKey="events"
                stroke="var(--color-events)"
                strokeWidth={2}
                dot={data.length === 1}
                isAnimationActive={animate}
              />
              <Line
                type="linear"
                dataKey="users"
                stroke="var(--color-users)"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={data.length === 1}
                isAnimationActive={animate}
              />
            </LineChart>
          </ChartContainer>
        </>
      ) : (
        <p className="issue-empty-copy">这个时间范围内没有趋势数据。</p>
      )}
    </section>
  );
}
