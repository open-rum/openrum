import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { countryLabel } from "@/features/filters/dimensionLabels";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import { bucketRows, chartTicks, intervalLabel, type TimeSeriesRow } from "@/lib/charts/timeSeries";
import { isolatedDot } from "@/lib/charts/isolatedDot";
import { useChartWidth } from "@/lib/charts/useChartWidth";
import type { IssueOverviewResponse } from "@/lib/api/issues";
import { formatIssueTrendTime, formatIssueTrendTooltip } from "./trendTime";

type ImpactDimension = "sessions" | "users" | "pages";
type DistributionDimension = "errorTypes" | "pages" | "countries";

const eventConfig = {
  events: { label: "问题次数", color: "var(--ds-chart-1)" },
} satisfies ChartConfig;

const impactConfig = {
  sessions: { label: "影响会话", color: "var(--ds-chart-1)" },
  anonymousUsers: { label: "匿名用户", color: "var(--ds-chart-1)" },
  identifiedUsers: { label: "业务用户", color: "var(--ds-chart-2)" },
  pages: { label: "影响页面", color: "var(--ds-chart-1)" },
} satisfies ChartConfig;

const distributionConfig = {
  events: { label: "错误事件" },
} satisfies ChartConfig;

const distributionColors = [
  "var(--ds-chart-1)",
  "var(--ds-chart-2)",
  "var(--ds-chart-3)",
  "var(--ds-chart-4)",
  "var(--ds-chart-5)",
  "var(--ds-chart-6)",
  "var(--ds-chart-7)",
  "var(--ds-chart-8)",
  "var(--ds-chart-9)",
  "var(--ds-chart-10)",
];

export function IssueOverviewCharts({ overview }: { overview: IssueOverviewResponse }) {
  const animate = useChartMotion();
  const [impactDimension, setImpactDimension] = useState<ImpactDimension>("sessions");
  const [distributionDimension, setDistributionDimension] =
    useState<DistributionDimension>("errorTypes");
  const trend = useMemo(() => bucketRows(overview.trend, overview), [overview]);
  const totalEvents = overview.trend.reduce((total, point) => total + point.events, 0);
  const distribution = useMemo(() => {
    const source = overview[distributionDimension];
    const visibleTotal = source.reduce((total, item) => total + item.events, 0);
    const items = source.map((item, index) => ({
      label: distributionLabel(distributionDimension, item.value),
      events: item.events,
      fill: distributionColors[index % distributionColors.length],
    }));
    const remaining = Math.max(0, totalEvents - visibleTotal);
    if (remaining > 0) {
      items.push({
        label: "其他",
        events: remaining,
        fill: "var(--ds-chart-10)",
      });
    }
    return items;
  }, [distributionDimension, overview, totalEvents]);

  return (
    <section className="grid gap-4 xl:grid-cols-3" aria-label="错误概览图表">
      <Card>
        <CardHeader>
          <CardTitle>问题次数</CardTitle>
          <CardDescription>当前时间范围内捕获的错误事件。</CardDescription>
        </CardHeader>
        <CardContent>
          <IntervalNote seconds={overview.intervalSeconds} />
          <IssueLineChart
            data={trend}
            config={eventConfig}
            lines={[{ key: "events", color: "var(--color-events)" }]}
            animate={animate}
            ariaLabel="问题次数趋势"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>影响范围</CardTitle>
          <CardDescription>{impactDescription(impactDimension)}</CardDescription>
          <CardAction>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              value={impactDimension}
              aria-label="切换影响范围"
              onValueChange={(value) => {
                if (value) setImpactDimension(value as ImpactDimension);
              }}
            >
              <ToggleGroupItem value="sessions">会话</ToggleGroupItem>
              <ToggleGroupItem value="users">用户</ToggleGroupItem>
              <ToggleGroupItem value="pages">页面</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          <IntervalNote seconds={overview.intervalSeconds} />
          <IssueLineChart
            data={trend}
            config={impactConfig}
            lines={impactLines(impactDimension)}
            animate={animate}
            ariaLabel={`${impactDescription(impactDimension)}趋势`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>错误分布</CardTitle>
          <CardDescription>{distributionDescription(distributionDimension)}</CardDescription>
          <CardAction>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              value={distributionDimension}
              aria-label="切换错误分布维度"
              onValueChange={(value) => {
                if (value) setDistributionDimension(value as DistributionDimension);
              }}
            >
              <ToggleGroupItem value="errorTypes">类型</ToggleGroupItem>
              <ToggleGroupItem value="pages">页面</ToggleGroupItem>
              <ToggleGroupItem value="countries">国家</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          {distribution.length ? (
            <div className="grid min-h-56 grid-cols-[minmax(0,1fr)_minmax(120px,0.8fr)] items-center gap-3">
              <ChartContainer
                config={distributionConfig}
                className="h-56 w-full"
                initialDimension={{ width: 220, height: 224 }}
                role="img"
                aria-label={`${distributionDescription(distributionDimension)}饼图`}
              >
                <PieChart accessibilityLayer>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        hideLabel
                        hideIndicator
                        formatter={(value, _name, item) => (
                          <div className="flex min-w-36 flex-1 items-center justify-between gap-4">
                            <span className="truncate text-muted-foreground">
                              {(item.payload as { label?: string }).label}
                            </span>
                            <span className="font-mono font-medium tabular-nums">
                              {Number(value).toLocaleString()}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={distribution}
                    dataKey="events"
                    nameKey="label"
                    outerRadius="82%"
                    paddingAngle={1.5}
                    strokeWidth={0}
                    isAnimationActive={animate}
                  />
                </PieChart>
              </ChartContainer>
              <ol className="flex min-w-0 flex-col gap-2" aria-label="错误分布图例">
                {distribution.slice(0, 6).map((item) => (
                  <li className="flex min-w-0 items-center gap-2 text-xs" key={item.label}>
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.fill }}
                      aria-hidden="true"
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-muted-foreground"
                      title={item.label}
                    >
                      {item.label}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatPercent(item.events, totalEvents)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <ChartEmpty />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function IssueLineChart({
  data,
  config,
  lines,
  animate,
  ariaLabel,
}: {
  data: Array<TimeSeriesRow & { timestamp: number }>;
  config: ChartConfig;
  lines: Array<{ key: string; color: string; dashed?: boolean }>;
  animate: boolean;
  ariaLabel: string;
}) {
  const { ref, width } = useChartWidth(data.length > 0);
  if (!data.length) return <ChartEmpty />;
  return (
    <ChartContainer
      ref={ref}
      config={config}
      className="h-56 w-full"
      initialDimension={{ width: 360, height: 224 }}
      role="img"
      aria-label={ariaLabel}
    >
      <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 3" />
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={["dataMin", "dataMax"]}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={36}
          ticks={chartTicks(data, width).map((label) => Date.parse(label))}
          tickFormatter={formatIssueTrendTime}
        />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={6} width={42} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={formatIssueTrendTooltip} />}
        />
        {lines.map((line) => (
          <Line
            key={line.key}
            {...smoothCurve}
            dataKey={line.key}
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray={line.dashed ? "4 3" : undefined}
            connectNulls={false}
            dot={isolatedDot({ rows: data }, line.key, line.color)}
            isAnimationActive={animate}
          />
        ))}
        {lines.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
      </LineChart>
    </ChartContainer>
  );
}

function IntervalNote({ seconds }: { seconds?: number }) {
  return seconds ? (
    <p className="mb-2 text-right text-xs text-muted-foreground" data-chart-interval={seconds}>
      自动 · {intervalLabel(seconds)}
    </p>
  ) : null;
}

function ChartEmpty() {
  return (
    <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
      当前范围暂无错误数据
    </div>
  );
}

function impactLines(dimension: ImpactDimension) {
  if (dimension === "users") {
    return [
      { key: "anonymousUsers", color: "var(--color-anonymousUsers)" },
      { key: "identifiedUsers", color: "var(--color-identifiedUsers)", dashed: true },
    ];
  }
  return [
    {
      key: dimension,
      color: dimension === "sessions" ? "var(--color-sessions)" : "var(--color-pages)",
    },
  ];
}

function impactDescription(dimension: ImpactDimension) {
  if (dimension === "users") return "匿名用户与已设置 user.id 的业务用户。";
  if (dimension === "pages") return "发生错误的独立页面访问。";
  return "发生错误的独立会话。";
}

function distributionDescription(dimension: DistributionDimension) {
  if (dimension === "pages") return "按异常页面查看错误占比。";
  if (dimension === "countries") return "按异常国家查看错误占比。";
  return "按异常类型查看错误占比。";
}

function distributionLabel(dimension: DistributionDimension, value: string) {
  if (value === "unknown")
    return dimension === "countries" ? "未知国家" : dimension === "pages" ? "未知页面" : "未知异常";
  return dimension === "countries" ? countryLabel(value) : value;
}

function formatPercent(value: number, total: number) {
  if (!total) return "0%";
  const percent = (value / total) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}
