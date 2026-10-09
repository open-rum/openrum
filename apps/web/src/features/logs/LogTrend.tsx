import { Bar, BarChart, BarStack, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BAR_RADIUS_TOP,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { completeLogTrend, logLevels, type LogPage } from "@/lib/api/logs";

const colors = {
  trace: "var(--ds-text-muted)",
  debug: "var(--ds-chart-2)",
  info: "var(--ds-chart-1)",
  warn: "var(--ds-warning)",
  error: "var(--ds-danger)",
  fatal: "var(--ds-text)",
};
const config = Object.fromEntries(
  logLevels.map((level) => [level, { label: level.toUpperCase(), color: colors[level] }]),
) satisfies ChartConfig;

export function LogTrend({ data, from, to }: { data: LogPage; from: string; to: string }) {
  const animate = useChartMotion();
  const points = completeLogTrend(data, from, to);
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>日志量</CardTitle>
        <CardDescription>
          已采集 {data.total.toLocaleString()} 条 · 按级别分布，不做采样估算
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className="logs-trend"
          initialDimension={{ width: 800, height: 160 }}
          role="img"
          aria-label="日志量趋势"
        >
          <BarChart
            data={points}
            accessibilityLayer
            margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 4" />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value: string) => date.format(new Date(value))}
              tickLine={false}
              axisLine={false}
              minTickGap={70}
            />
            <YAxis width={40} allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => date.format(new Date(String(value)))}
                />
              }
            />
            <BarStack stackId="logs" radius={BAR_RADIUS_TOP}>
              {logLevels.map((level) => (
                <Bar
                  key={level}
                  dataKey={level}
                  fill={`var(--color-${level})`}
                  isAnimationActive={animate}
                  maxBarSize={24}
                />
              ))}
            </BarStack>
          </BarChart>
        </ChartContainer>
        <div className="logs-legend">
          {logLevels.map((level) => (
            <span key={level}>
              <i style={{ background: colors[level] }} />
              {level.toUpperCase()}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
