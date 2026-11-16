import { useId, useState } from "react";
import { timeAxis, valueAxis, VALUE_AXIS_MARGIN_TOP } from "@/lib/charts/axes";
import { ChartAreaIcon, ChartColumnIcon, ChartLineIcon } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartSwitch } from "@/components/daisy/ChartSwitch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBarRadiusTop } from "@/lib/charts/useBarRadius";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import { isolatedDot } from "@/lib/charts/isolatedDot";
import { intervalLabel, type TimeSeriesRow } from "@/lib/charts/timeSeries";
import {
  formatPerformanceMetric,
  type PerformancePercentile,
  type PerformanceResponse,
} from "@/lib/api/performance";
import { combinedTrend, vitalSeries } from "./combinedTrend";
import { formatTrendDate } from "./trendTime";

const config = Object.fromEntries(
  vitalSeries.map(({ key, name, color }) => [key, { label: name, color }]),
) satisfies ChartConfig;

export type VitalTrendView = "line" | "area" | "bar";

const viewNames = { line: "折线图", area: "面积图", bar: "柱状图" } as const;

const views = [
  [
    "line",
    <>
      <ChartLineIcon className="size-3.5" aria-hidden="true" />
      折线
    </>,
  ],
  [
    "area",
    <>
      <ChartAreaIcon className="size-3.5" aria-hidden="true" />
      面积
    </>,
  ],
  [
    "bar",
    <>
      <ChartColumnIcon className="size-3.5" aria-hidden="true" />
      柱状
    </>,
  ],
] as const satisfies readonly (readonly [VitalTrendView, unknown])[];

export function CombinedVitalTrend({
  trend,
  range,
  percentile,
}: {
  trend: PerformanceResponse["trend"];
  range?: { from?: string; to?: string; intervalSeconds?: number };
  percentile: PerformancePercentile;
}) {
  const animate = useChartMotion();
  const barRadius = useBarRadiusTop();
  const gradientId = useId().replace(/:/g, "");
  const [view, setView] = useState<VitalTrendView>("line");
  const [visible, setVisible] = useState<string[]>(() =>
    vitalSeries.filter(({ core }) => core).map(({ key }) => key),
  );
  const data = combinedTrend(trend, percentile, range);
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
          <CardDescription>
            真实指标值 · 越低越好
            {range?.intervalSeconds ? ` · 自动 · ${intervalLabel(range.intervalSeconds)}` : ""}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChartSwitch label="图表类型" options={views} value={view} onChange={setView} />
        </div>
      </CardHeader>
      <CardContent>
        {/* Units sit on the axes themselves ("3,400 ms", "0.1 CLS"), so no caption row. */}
        {hasData ? (
          <ChartContainer
            className="performance-combined-chart"
            config={config}
            initialDimension={{ width: 640, height: 240 }}
            role="img"
            aria-label={`Web Vitals ${percentile.toUpperCase()} 真实值趋势 · ${viewNames[view]}`}
          >
            <ComposedChart
              accessibilityLayer
              data={data}
              margin={{ top: VALUE_AXIS_MARGIN_TOP, right: 0, bottom: 4, left: 0 }}
              barCategoryGap="25%"
              barGap={1}
            >
              <defs>
                {series.map(({ key, color }) => (
                  <linearGradient key={key} id={`${gradientId}-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={color}
                      stopOpacity={series.length > 1 ? 0.3 : 0.55}
                    />
                    <stop offset="100%" stopColor={color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--ds-border-soft)"
                strokeDasharray="2 3"
              />
              <XAxis
                dataKey="bucket"
                minTickGap={40}
                {...timeAxis((value) => formatTrendDate(String(value), shortRange))}
              />
              <YAxis
                yAxisId="time"
                hide={!hasTiming}
                domain={[0, "auto"]}
                {...valueAxis({
                  unit: "ms",
                  format: (value) => Math.round(value).toLocaleString("zh-CN"),
                })}
              />
              <YAxis
                yAxisId="cls"
                hide={!hasCLS}
                domain={[0, "auto"]}
                {...valueAxis({
                  side: "right",
                  unit: "CLS",
                  format: (value) => Number(value.toFixed(3)).toString(),
                })}
              />
              <ChartTooltip
                cursor={
                  view === "bar"
                    ? { fill: "var(--color-base-200)" }
                    : { stroke: "var(--ds-border)" }
                }
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
              {series.map(({ key, dash }) => {
                const axis = key === "cls" ? "cls" : "time";
                const color = `var(--color-${key})`;
                const dot = isolatedDot({ rows: data as unknown as TimeSeriesRow[] }, key, color);
                if (view === "bar")
                  return (
                    <Bar
                      key={key}
                      yAxisId={axis}
                      dataKey={key}
                      fill={color}
                      radius={barRadius}
                      maxBarSize={12}
                      isAnimationActive={animate}
                    />
                  );
                if (view === "area")
                  return (
                    <Area
                      key={key}
                      yAxisId={axis}
                      {...smoothCurve}
                      dataKey={key}
                      stroke={color}
                      strokeDasharray={dash}
                      fill={`url(#${gradientId}-${key})`}
                      strokeWidth={1.5}
                      dot={dot}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
                      isAnimationActive={animate}
                    />
                  );
                return (
                  <Line
                    key={key}
                    yAxisId={axis}
                    {...smoothCurve}
                    dataKey={key}
                    stroke={color}
                    strokeDasharray={dash}
                    strokeWidth={2}
                    dot={dot}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    isAnimationActive={animate}
                  />
                );
              })}
            </ComposedChart>
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
