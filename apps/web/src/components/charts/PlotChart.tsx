import { useEffect, useId, useRef, useState } from "react";
import {
  Area,
  Bar,
  BarStack,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  BAR_RADIUS_TOP,
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
import { countryGroupLabel } from "@/features/filters/dimensionLabels";
import { isolatedDot } from "@/lib/charts/isolatedDot";
import { COMPARISON_DASH, COMPARISON_STROKE } from "@/lib/charts/palette";
import {
  formatDetailedMetric,
  formatMetric,
  PARTIAL_SUFFIX,
  type PlotData,
} from "@/lib/charts/plotData";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import { chartTicks, intervalLabel, timeTickLabel } from "@/lib/charts/timeSeries";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { observeElementWidth } from "@/lib/charts/useChartWidth";
import { CategoryRanking } from "./CategoryRanking";
import { DonutDistribution } from "./DonutDistribution";

export type PlotView = "area" | "line" | "bar" | "table" | "donut" | "stacked-area" | "stacked-bar";

export type PlotChartProps = {
  data: PlotData;
  view: PlotView;
  title: string;
  detailed?: boolean;
  showTable?: boolean;
  showNotes?: boolean;
  showInterval?: boolean;
  /** Fills the height its parent gives it and drops the legend and the notes under the chart. */
  compact?: boolean;
  /** Set false to leave out the legend, for a chart whose header already names its series. */
  legend?: boolean;
};

/**
 * The Console's chart for a series or a set of categories: area, line, bar, stacked area or
 * bar, a donut, or a table, drawn from PlotData. The dashboard and the Events page both use
 * it, so the same data looks the same wherever it appears.
 */
export function PlotChart({
  data,
  view,
  title,
  detailed = false,
  showTable = detailed,
  showNotes = detailed,
  // Cards stay uncluttered; the aggregation interval is listed in 详细.
  showInterval = false,
  compact = false,
  legend = true,
}: PlotChartProps) {
  const gradientId = `module-${useId().replace(/:/g, "")}`;
  // Recharts names a stack's clip paths after its stackId, and ids are document-wide. A fixed
  // id lets a second stacked chart on the page (a drawer over its page) borrow the first one's
  // clip and vanish, so every chart gets its own.
  const stackId = gradientId;
  const animate = useChartMotion();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const empty = data.empty;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    return observeElementWidth(element, setWidth);
  }, [empty, view]);
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
  // A second value axis exists only when a series asks for it, in another unit.
  const rightSeries = data.series.find((series) => series.axis === "right");
  const axisId = (series: { axis?: "left" | "right" }) =>
    rightSeries ? (series.axis === "right" ? "right" : "left") : undefined;
  const currentSeries = data.series.filter(
    (series) => series.role !== "previous" && series.role !== "partial",
  );
  const unit = data.series[0].unit;
  const config: ChartConfig = Object.fromEntries(
    data.series.map((series) => [
      series.key,
      { label: series.label, color: view === "line" ? series.ink : series.color },
    ]),
  );
  return (
    <div
      ref={container}
      className={compact ? "flex h-full min-w-0 flex-col" : "flex min-w-0 flex-col gap-3"}
    >
      {showInterval && !compact && !categories && data.intervalSeconds ? (
        <p
          className="text-right text-xs text-muted-foreground"
          data-chart-interval={data.intervalSeconds}
        >
          自动 · {intervalLabel(data.intervalSeconds)}
        </p>
      ) : null}
      {view === "donut" ? (
        <>
          <DonutDistribution data={data} title={title} />
          {showTable ? (
            <PlotTable
              data={data}
              title={title}
              countryLabels={data.distribution?.dimension === "country"}
            />
          ) : null}
        </>
      ) : view === "table" ? (
        <PlotTable data={data} title={title} />
      ) : categories && view === "bar" ? (
        <CategoryRanking data={data} title={title} detailed={detailed} />
      ) : (
        <>
          <ChartContainer
            config={config}
            className={
              compact
                ? "h-full min-h-0 w-full"
                : detailed
                  ? "h-80 w-full sm:h-96"
                  : "h-64 w-full min-[1680px]:h-72"
            }
            initialDimension={{ width: 600, height: 256 }}
            aria-label={title}
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
                yAxisId={rightSeries ? "left" : undefined}
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
              {rightSeries ? (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={48}
                  axisLine={false}
                  tickLine={false}
                  tickCount={5}
                  domain={rightSeries.unit === "percent" ? [0, 100] : undefined}
                  tickFormatter={(value: number) =>
                    rightSeries.unit === "percent"
                      ? `${Math.round(value)}%`
                      : formatMetric(value, rightSeries.unit)
                  }
                />
              ) : null}
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    itemFilter={partialAwareFilter(data)}
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
                          {formatMetric(
                            typeof value === "number" ? value : null,
                            data.series.find((series) => series.key === String(name))?.unit ?? unit,
                          )}
                        </strong>
                      </div>
                    )}
                  />
                }
              />
              {data.thresholds ? (
                <>
                  <ReferenceLine
                    yAxisId={rightSeries ? "left" : undefined}
                    y={data.thresholds.good}
                    stroke="var(--ds-success)"
                    strokeDasharray="4 4"
                  />
                  <ReferenceLine
                    yAxisId={rightSeries ? "left" : undefined}
                    y={data.thresholds.poor}
                    stroke="var(--ds-warning)"
                    strokeDasharray="4 4"
                  />
                </>
              ) : null}
              {/* The previous period sits behind the current one, dashed in the comparison
                  colour, so it reads as context rather than a second series. */}
              {data.series
                .filter((series) => series.role === "previous")
                .map((series) => (
                  <Line
                    key={series.key}
                    dataKey={series.key}
                    yAxisId={axisId(series)}
                    {...smoothCurve}
                    stroke={COMPARISON_STROKE}
                    strokeDasharray={COMPARISON_DASH}
                    strokeWidth={1.5}
                    dot={isolatedDot(data, series.key, COMPARISON_STROKE)}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={animate}
                  />
                ))}
              {/* The stretch of a series that covers a bucket still running: dashed, in the
                  series' own colour, and kept out of the legend and the tooltip's totals. */}
              {data.series
                .filter((series) => series.role === "partial")
                .map((series) => (
                  <Line
                    key={series.key}
                    dataKey={series.key}
                    yAxisId={axisId(series)}
                    {...smoothCurve}
                    stroke={series.ink}
                    strokeDasharray={COMPARISON_DASH}
                    strokeWidth={2}
                    dot={isolatedDot(data, series.key, series.ink)}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={animate}
                    legendType="none"
                  />
                ))}
              {data.stacked && view === "stacked-bar" ? (
                <BarStack stackId={stackId} radius={BAR_RADIUS_TOP}>
                  {currentSeries.map((series) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      yAxisId={axisId(series)}
                      fill={series.color}
                      maxBarSize={32}
                      isAnimationActive={animate}
                    />
                  ))}
                </BarStack>
              ) : (
                currentSeries.map((series, index) =>
                  data.stacked ? (
                    <Area
                      key={series.key}
                      dataKey={series.key}
                      yAxisId={axisId(series)}
                      stackId={stackId}
                      {...smoothCurve}
                      stroke={series.ink}
                      fill={series.color}
                      fillOpacity={0.35}
                      strokeWidth={1}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={animate}
                    />
                  ) : view === "bar" ? (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      yAxisId={axisId(series)}
                      fill={series.color}
                      radius={BAR_RADIUS_TOP}
                      maxBarSize={categories ? 16 : 32}
                      isAnimationActive={animate}
                    />
                  ) : view === "line" || index > 0 ? (
                    <Line
                      key={series.key}
                      dataKey={series.key}
                      yAxisId={axisId(series)}
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
                      yAxisId={axisId(series)}
                      {...smoothCurve}
                      stroke={series.ink}
                      fill={`url(#${gradientId}-${index})`}
                      strokeWidth={1.5}
                      dot={isolatedDot(data, series.key, series.ink)}
                      connectNulls={false}
                      isAnimationActive={animate}
                    />
                  ),
                )
              )}
              {data.series.length > 1 && legend ? (
                <ChartLegend content={<ChartLegendContent />} />
              ) : null}
            </ComposedChart>
          </ChartContainer>
          {data.edgeNote && !compact ? (
            <p className="text-xs text-muted-foreground">{data.edgeNote}</p>
          ) : null}
          {showTable ? <PlotTable data={data} title={title} /> : null}
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
                    ? countryGroupLabel(String(row.label))
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

/**
 * A partial series has no value where its twin does, and the twin has none where the partial
 * one begins, so the tooltip shows one row per metric: the solid value when there is one,
 * otherwise the partial one.
 */
function partialAwareFilter(data: PlotData) {
  if (!data.series.some((series) => series.role === "partial")) return undefined;
  return (
    item: { dataKey?: unknown; value?: unknown },
    items: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>,
  ) => {
    const key = String(item.dataKey);
    if (key.endsWith(PARTIAL_SUFFIX)) {
      const base = items.find(
        (other) => String(other.dataKey) === key.slice(0, -PARTIAL_SUFFIX.length),
      );
      return base?.value == null;
    }
    const hasPartial = data.series.some((series) => series.key === `${key}${PARTIAL_SUFFIX}`);
    return !(hasPartial && item.value == null);
  };
}
