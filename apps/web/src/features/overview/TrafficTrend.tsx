import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import type { OverviewResponse } from "@/lib/api/client";
import { bucketFormatter, compactCount } from "./format";

// Both series are counts, so they share one scale and their vertical distance
// stays meaningful. UV is a subset of PV rather than a separate quantity, so it
// rides as a bare line over the PV band instead of stacking.
const config = {
  pageViews: { label: "PV", color: "var(--ds-primary)" },
  uniqueUsers: { label: "UV", color: "var(--ds-secondary)" },
} satisfies ChartConfig;

export function TrafficTrend({ series }: { series: OverviewResponse["series"] }) {
  const animate = useChartMotion();
  const data = series.map((point) => ({
    bucket: point.bucket,
    pageViews: point.pageViews.value,
    uniqueUsers: point.uniqueUsers.value,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>访问量</CardTitle>
        <CardDescription>PV 与近似 UV 使用相同的 UTC 时间桶。</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">当前范围暂无趋势数据。</p>
        ) : (
          <ChartContainer
            config={config}
            className="h-64 w-full"
            initialDimension={{ width: 600, height: 256 }}
            role="img"
            aria-label="PV 与 UV 时间趋势"
          >
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="overviewTraffic-pageViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-pageViews)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-pageViews)" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--ds-border-soft)"
                strokeDasharray="2 3"
              />
              <XAxis
                dataKey="bucket"
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={bucketFormatter}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={52}
                tickMargin={6}
                tickFormatter={compactCount}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
                      return point ? bucketFormatter(point.bucket) : "";
                    }}
                  />
                }
              />
              <Area
                dataKey="pageViews"
                {...smoothCurve}
                stroke="var(--color-pageViews)"
                strokeWidth={1.5}
                fill="url(#overviewTraffic-pageViews)"
                isAnimationActive={animate}
              />
              <Line
                dataKey="uniqueUsers"
                {...smoothCurve}
                stroke="var(--color-uniqueUsers)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={animate}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
