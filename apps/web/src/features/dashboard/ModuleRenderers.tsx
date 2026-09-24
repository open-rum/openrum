import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { countryMapLabel } from "@/components/world-map/data";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import { TopIssuesContent } from "@/features/overview/TopIssues";
import { SlowApisContent } from "@/features/overview/SlowApis";
import { chartTicks, intervalLabel, timeTickLabel } from "./chartDensity";
import { formatMetric, formatDetailedMetric, type AdaptedData, type PlotData } from "./adapters";
import type { Widget } from "./model";
import { ModuleComparison } from "./ModuleComparison";
import { StatTrend } from "./StatTrend";
import { isolatedDot } from "./isolatedDot";
import { DonutDistribution } from "./DonutDistribution";
import { CategoryRanking } from "./CategoryRanking";

export type ModuleRenderProps = {
  widget: Widget;
  data: AdaptedData;
  detailed?: boolean;
  showTable?: boolean;
  showNotes?: boolean;
  showInterval?: boolean;
};

const WorldMap = lazy(() =>
  import("@/components/WorldMap").then((module) => ({ default: module.WorldMap })),
);
const formatCountryValue = (value: number) => formatDetailedMetric(value, "count");

export function StatRenderer({ widget, data }: ModuleRenderProps) {
  if (data.kind !== "scalar") return null;
  const summary = (
    <div className="relative z-10 flex min-w-0 flex-col gap-3">
      <strong className="text-3xl font-semibold tracking-tight tabular-nums">
        {formatMetric(data.value, data.unit)}
      </strong>
      <ModuleComparison widget={widget} data={data} />
    </div>
  );
  const appearance = widget.statAppearance ?? "plain";
  if (appearance === "plain") return summary;
  return (
    <div
      data-stat-appearance={appearance}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-3"
    >
      {summary}
      <StatTrend data={data.trend} appearance={appearance} />
    </div>
  );
}

export function PlotRenderer({
  widget,
  data,
  detailed = false,
  showTable = detailed,
  showNotes = detailed,
  showInterval = true,
}: ModuleRenderProps) {
  const gradientId = `module-${useId().replace(/:/g, "")}`;
  const animate = useChartMotion();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const empty = "empty" in data && data.empty;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [empty, widget.view]);
  if (data.kind !== "series" && data.kind !== "categories") return null;
  if (data.empty || !data.rows.length)
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyTitle>当前范围暂无数据</EmptyTitle>
          <EmptyDescription>可以调整时间、环境或模块筛选；配置会保留。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const categories = data.kind === "categories";
  const unit = data.series[0].unit;
  const config: ChartConfig = Object.fromEntries(
    data.series.map((series) => [
      series.key,
      { label: series.label, color: widget.view === "line" ? series.ink : series.color },
    ]),
  );
  return (
    <div ref={container} className="flex min-w-0 flex-col gap-3">
      {showInterval && !categories && data.intervalSeconds ? (
        <p
          className="text-right text-xs text-muted-foreground"
          data-chart-interval={data.intervalSeconds}
        >
          自动 · {intervalLabel(data.intervalSeconds)}
        </p>
      ) : null}
      {widget.view === "donut" ? (
        <>
          <DonutDistribution data={data} title={widget.title} />
          {showTable ? (
            <PlotTable
              data={data}
              title={widget.title}
              countryLabels={data.distribution?.dimension === "country"}
            />
          ) : null}
        </>
      ) : widget.view === "map" ? (
        <>
          <Suspense fallback={<Skeleton className="h-64 w-full" aria-label="正在加载世界地图" />}>
            <WorldMap
              title={widget.title}
              metricLabel={data.series[0].label}
              formatValue={formatCountryValue}
              data={data.rows.map((row) => ({
                code: String(row.label),
                value: Number(row[data.series[0].key]),
              }))}
            />
          </Suspense>
          {showTable ? <PlotTable data={data} title={widget.title} countryLabels /> : null}
        </>
      ) : widget.view === "table" ? (
        <PlotTable data={data} title={widget.title} />
      ) : categories && widget.view === "bar" ? (
        <CategoryRanking data={data} title={widget.title} detailed={detailed} />
      ) : (
        <>
          <ChartContainer
            config={config}
            className={detailed ? "h-80 w-full sm:h-96" : "h-64 w-full"}
            initialDimension={{ width: 600, height: 256 }}
            aria-label={widget.title}
          >
            <ComposedChart
              data={data.rows}
              layout={categories ? "vertical" : "horizontal"}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
              barCategoryGap="25%"
              barGap={2}
              accessibilityLayer
            >
              <defs>
                {data.series.map((series, index) => (
                  <linearGradient
                    key={series.key}
                    id={`${gradientId}-${index}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={series.color} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={series.color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={categories}
                horizontal={!categories}
                stroke="var(--ds-border-soft)"
                strokeDasharray="2 3"
              />
              <XAxis
                type={categories ? "number" : "category"}
                dataKey={categories ? undefined : "label"}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
                ticks={categories ? undefined : chartTicks(data.rows, width)}
                interval={categories ? undefined : "preserveStartEnd"}
                tickMargin={8}
                tickFormatter={
                  categories
                    ? (value: number) => formatMetric(value, unit)
                    : (value: string) => timeTickLabel(value, data.rangeMs ?? 0)
                }
              />
              <YAxis
                type={categories ? "category" : "number"}
                dataKey={categories ? "label" : undefined}
                width={categories ? 94 : 60}
                axisLine={false}
                tickLine={false}
                tickCount={5}
                tickFormatter={
                  categories
                    ? (value: string) => (value.length > 12 ? `${value.slice(0, 12)}…` : value)
                    : (value: number) => formatMetric(value, unit)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const label = payload?.[0]?.payload?.label as string | undefined;
                      return label
                        ? categories
                          ? label
                          : new Date(label).toLocaleString("zh-CN")
                        : "";
                    }}
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          {config[String(name)]?.label ?? String(name)}
                        </span>
                        <strong className="font-mono tabular-nums">
                          {formatMetric(typeof value === "number" ? value : null, unit)}
                        </strong>
                      </div>
                    )}
                  />
                }
              />
              {data.thresholds ? (
                <>
                  <ReferenceLine
                    y={data.thresholds.good}
                    stroke="var(--ds-success)"
                    strokeDasharray="4 4"
                  />
                  <ReferenceLine
                    y={data.thresholds.poor}
                    stroke="var(--ds-warning)"
                    strokeDasharray="4 4"
                  />
                </>
              ) : null}
              {data.series.map((series, index) =>
                widget.view === "bar" ? (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    fill={series.color}
                    radius={3}
                    maxBarSize={categories ? 16 : 32}
                    isAnimationActive={animate}
                  />
                ) : widget.view === "line" || index > 0 ? (
                  <Line
                    key={series.key}
                    dataKey={series.key}
                    {...smoothCurve}
                    stroke={series.ink}
                    strokeWidth={2}
                    dot={isolatedDot(data, series.key, series.ink)}
                    connectNulls={false}
                    isAnimationActive={animate}
                  />
                ) : (
                  <Area
                    key={series.key}
                    dataKey={series.key}
                    {...smoothCurve}
                    stroke={series.ink}
                    fill={`url(#${gradientId}-${index})`}
                    strokeWidth={1.5}
                    dot={isolatedDot(data, series.key, series.ink)}
                    connectNulls={false}
                    isAnimationActive={animate}
                  />
                ),
              )}
              {data.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
            </ComposedChart>
          </ChartContainer>
          {showTable ? <PlotTable data={data} title={widget.title} /> : null}
        </>
      )}
      {showNotes ? (
        <p className="text-xs text-muted-foreground">
          {data.note}
          {data.thresholds
            ? ` · 参考线 ${formatMetric(data.thresholds.good, unit)} / ${formatMetric(data.thresholds.poor, unit)}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

export function PlotTable({
  data,
  title,
  countryLabels = false,
}: {
  data: PlotData;
  title: string;
  countryLabels?: boolean;
}) {
  const samples = data.rows.some((row) => row.samples !== undefined);
  return (
    <div
      className="dashboard-plot-table max-h-72 overflow-auto"
      tabIndex={0}
      role="region"
      aria-label={`${title} 数据表滚动区域`}
    >
      <Table aria-label={`${title} 数据表`}>
        <TableHeader>
          <TableRow>
            <TableHead>
              {data.kind === "series" ? "时间" : countryLabels ? "国家 / 地区" : "分组"}
            </TableHead>
            {data.series.map((s) => (
              <TableHead key={s.key}>{s.label}</TableHead>
            ))}
            {samples ? <TableHead>样本</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, index) => (
            <TableRow key={`${row.label}-${index}`}>
              <TableCell>
                {data.kind === "series"
                  ? new Date(String(row.label)).toLocaleString("zh-CN")
                  : countryLabels
                    ? countryMapLabel(String(row.label))
                    : row.label}
              </TableCell>
              {data.series.map((s) => (
                <TableCell key={s.key}>
                  {formatDetailedMetric(
                    typeof row[s.key] === "number" ? (row[s.key] as number) : null,
                    s.unit,
                  )}
                </TableCell>
              ))}
              {samples ? <TableCell>{row.samples}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ListRenderer({ data }: ModuleRenderProps) {
  if (data.kind === "issues")
    return <TopIssuesContent issues={data.issues} filters={data.filters} />;
  if (data.kind === "apis") return <SlowApisContent apis={data.apis} filters={data.filters} />;
  return null;
}
