import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import {
  formatPerformanceMetric,
  type PerformancePercentile,
  type PerformanceResponse,
} from "@/lib/api/performance";
import { combinedTrend, vitalSeries } from "./combinedTrend";
import { PercentileSelect } from "./PerformanceControls";
import { formatTrendDate } from "./trendTime";

const config = Object.fromEntries(
  vitalSeries.map(({ key, name, color }) => [key, { label: name, color }]),
) satisfies ChartConfig;

export function CombinedVitalTrend({
  trend,
  percentile,
  onPercentileChange,
}: {
  trend: PerformanceResponse["trend"];
  percentile: PerformancePercentile;
  onPercentileChange: (value: PerformancePercentile) => void;
}) {
  const animate = useChartMotion();
  const [visible, setVisible] = useState<string[]>(() => vitalSeries.map(({ key }) => key));
  const data = combinedTrend(trend, percentile);
  const series = vitalSeries.filter(({ key }) => visible.includes(key));
  const hasData = data.some((point) => series.some(({ key }) => point[key] !== null));
  const hasTiming = series.some(({ key }) => key !== "cls");
  const hasCLS = visible.includes("cls");
  const shortRange =
    data.length > 0 &&
    Date.parse(data[data.length - 1].bucket) - Date.parse(data[0].bucket) < 2 * 86400000;
  return (
    <Card className="performance-combined-card">
      <CardHeader>
        <div>
          <CardTitle>性能趋势</CardTitle>
          <CardDescription>真实指标值 · 越低越好</CardDescription>
        </div>
        <PercentileSelect value={percentile} onChange={onPercentileChange} />
      </CardHeader>
      <CardContent>
        <div className="performance-axis-description">
          <span>{hasTiming ? "左轴：耗时 (ms)" : ""}</span>
          <span>{hasCLS ? "右轴：CLS（无单位）" : ""}</span>
        </div>
        {hasData ? (
          <ChartContainer
            className="performance-combined-chart"
            config={config}
            initialDimension={{ width: 640, height: 240 }}
            role="img"
            aria-label={`Web Vitals ${percentile.toUpperCase()} 真实值趋势`}
          >
            <LineChart
              accessibilityLayer
              data={data}
              margin={{ top: 8, right: 0, bottom: 4, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--ds-border-soft)"
                strokeDasharray="2 3"
              />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                minTickGap={40}
                tickMargin={10}
                tickFormatter={(value) => formatTrendDate(value, shortRange)}
              />
              <YAxis
                yAxisId="time"
                hide={!hasTiming}
                tickLine={false}
                axisLine={false}
                width={52}
                domain={[0, "auto"]}
                tickFormatter={(value: number) => Math.round(value).toLocaleString()}
              />
              <YAxis
                yAxisId="cls"
                orientation="right"
                hide={!hasCLS}
                tickLine={false}
                axisLine={false}
                width={42}
                domain={[0, "auto"]}
                tickFormatter={(value: number) => Number(value.toFixed(3)).toString()}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--ds-border)" }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!active || !point) return null;
                  return (
                    <div className="performance-chart-tooltip performance-combined-tooltip">
                      <strong>
                        {formatTrendDate(point.bucket, true)} · {percentile.toUpperCase()}
                      </strong>
                      {series.map(({ key, name, color }) => (
                        <div key={key}>
                          <i style={{ background: color }} />
                          <span>{name}</span>
                          <strong>{formatPerformanceMetric(point[key], name)}</strong>
                          <small>{(point.raw[key]?.samples ?? 0).toLocaleString()} 样本</small>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              {series.map(({ key, dash }) => (
                <Line
                  key={key}
                  yAxisId={key === "cls" ? "cls" : "time"}
                  type="linear"
                  dataKey={key}
                  stroke={`var(--color-${key})`}
                  strokeDasharray={dash}
                  strokeWidth={2}
                  dot={data.length === 1}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={animate}
                />
              ))}
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="performance-metric-trend-empty">当前显示的指标暂无趋势数据</div>
        )}
        <div className="performance-trend-legend">
          <ToggleGroup
            type="multiple"
            variant="legend"
            size="sm"
            spacing={1}
            value={visible}
            aria-label="显示趋势指标"
            onValueChange={(next) => {
              if (next.length) setVisible(next);
            }}
          >
            {vitalSeries.map(({ key, name, color, dash }) => (
              <ToggleGroupItem key={key} value={key} aria-label={`${name} 趋势`}>
                <svg viewBox="0 0 24 8" width="24" height="8" aria-hidden="true">
                  <line
                    x1="0"
                    x2="24"
                    y1="4"
                    y2="4"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray={dash}
                  />
                </svg>
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardContent>
    </Card>
  );
}
