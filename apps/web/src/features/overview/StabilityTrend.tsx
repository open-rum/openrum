import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
import type { OverviewResponse } from "@/lib/api/client";
import { bucketFormatter } from "./format";

// Both series are percentages, which is what lets them share an axis. The
// previous revision of this panel put counts and a percentage on twin axes, so
// the gap between the lines encoded nothing.
const config = {
  errorRate: { label: "错误率", color: "var(--ds-danger)" },
  apiFailureRate: { label: "API 失败率", color: "var(--ds-warning)" },
} satisfies ChartConfig;

export function StabilityTrend({ series }: { series: OverviewResponse["series"] }) {
  const animate = useChartMotion();
  const data = series.map((point) => ({
    bucket: point.bucket,
    // Buckets with no traffic report null rather than zero. Passing the null
    // through leaves a gap instead of drawing a drop to a healthy-looking 0%.
    errorRate: point.errorRate.value === null ? null : point.errorRate.value * 100,
    apiFailureRate: point.apiFailureRate.value === null ? null : point.apiFailureRate.value * 100,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>稳定性</CardTitle>
        <CardDescription>
          错误率与 API 失败率都是百分比，共用一条坐标轴；无流量的时间桶留空而不是记 0%。
        </CardDescription>
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
            aria-label="错误率与 API 失败率时间趋势"
          >
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                tickFormatter={(value: number) => `${value.toFixed(value < 1 ? 2 : 0)}%`}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--ds-border)" }}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
                      return point ? bucketFormatter(point.bucket) : "";
                    }}
                    formatter={(value, name) => (
                      <span className="flex w-full justify-between gap-4">
                        <span>{config[name as keyof typeof config]?.label ?? name}</span>
                        <span className="tabular-nums">
                          {typeof value === "number" ? `${value.toFixed(2)}%` : "—"}
                        </span>
                      </span>
                    )}
                  />
                }
              />
              <Line
                dataKey="errorRate"
                type="natural"
                stroke="var(--color-errorRate)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={animate}
              />
              <Line
                dataKey="apiFailureRate"
                type="natural"
                stroke="var(--color-apiFailureRate)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={animate}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
