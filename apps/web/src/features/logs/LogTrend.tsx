import { Bar, BarChart, BarStack, CartesianGrid, XAxis, YAxis } from "recharts";
import { timeAxis, valueAxis, VALUE_AXIS_MARGIN_TOP } from "@/lib/charts/axes";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { completeLogTrend, logLevels, type LogPage } from "@/lib/api/logs";
import { useBarRadiusTop } from "@/lib/charts/useBarRadius";
import { chartTicks, intervalLabel, timeTickLabel } from "@/lib/charts/timeSeries";
import { useChartWidth } from "@/lib/charts/useChartWidth";
import { logBucketRange, logTime } from "./logNavigation";

const colors = {
  trace: "var(--color-base-content)",
  debug: "var(--color-secondary)",
  info: "var(--color-primary)",
  warn: "var(--color-warning)",
  error: "var(--color-error)",
  fatal: "var(--color-neutral)",
};
const config = Object.fromEntries(
  logLevels.map((level) => [`logs_${level}`, { label: level.toUpperCase(), color: colors[level] }]),
) satisfies ChartConfig;

export function LogTrend({
  data,
  from,
  to,
  onRange,
}: {
  data: LogPage;
  from: string;
  to: string;
  onRange: (range: { from: string; to: string }) => void;
}) {
  const barRadius = useBarRadiusTop();
  const animate = useChartMotion();
  const { ref, width } = useChartWidth();
  const points = completeLogTrend(data, from, to).map((point) => ({
    ...point,
    ...Object.fromEntries(logLevels.map((key) => [`logs_${key}`, point[key]])),
  }));
  const selectBucket = (bucket: string) => {
    const range = logBucketRange(bucket, data.intervalSeconds, from, to);
    if (range) onRange(range);
  };
  return (
    <section className="card card-border bg-base-100" aria-label="日志趋势">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold">日志上报量</h2>
        <span className="text-xs text-base-content/70">
          每 {intervalLabel(data.intervalSeconds)}
        </span>
      </div>
      <div ref={ref} className="px-4">
        <ChartContainer
          config={config}
          className="h-28 w-full aspect-auto"
          initialDimension={{ width: 800, height: 112 }}
          aria-label="按级别统计的日志量；可点击柱形查看该时间段日志"
        >
          <BarChart
            data={points}
            accessibilityLayer
            margin={{ left: 0, right: 0, top: VALUE_AXIS_MARGIN_TOP, bottom: 0 }}
            onClick={(state) => {
              if (state.activeLabel) selectBucket(String(state.activeLabel));
            }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 4" />
            <XAxis
              dataKey="label"
              ticks={chartTicks(points, width)}
              {...timeAxis((value) =>
                timeTickLabel(String(value), Date.parse(to) - Date.parse(from)),
              )}
            />
            <YAxis allowDecimals={false} {...valueAxis({ unit: "条" })} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    const range = logBucketRange(String(value), data.intervalSeconds, from, to);
                    if (!range) return "";
                    const partial =
                      Date.parse(range.to) - Date.parse(range.from) < data.intervalSeconds * 1000;
                    return `${logTime(range.from)} – ${logTime(range.to)}${partial ? "（部分时段）" : ""}`;
                  }}
                />
              }
            />
            <BarStack stackId="logs" radius={barRadius}>
              {logLevels.map((key) => (
                <Bar
                  key={key}
                  dataKey={`logs_${key}`}
                  fill={`var(--color-logs_${key})`}
                  isAnimationActive={animate}
                  maxBarSize={28}
                  cursor="pointer"
                />
              ))}
            </BarStack>
          </BarChart>
        </ChartContainer>
      </div>
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 pt-1 text-xs text-base-content/70"
        aria-label="日志级别图例"
      >
        {logLevels.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-selector"
              style={{ background: colors[key] }}
              aria-hidden="true"
            />
            <span>{key.toUpperCase()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
