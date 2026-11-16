import { useState } from "react";
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
type LogLevel = (typeof logLevels)[number];

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
  const [hiddenLevels, setHiddenLevels] = useState<LogLevel[]>([]);
  const [hoveredLevel, setHoveredLevel] = useState<LogLevel | null>(null);
  const [focusedLevel, setFocusedLevel] = useState<LogLevel | null>(null);
  const activeLevel = hoveredLevel ?? focusedLevel;
  const highlightedLevel = activeLevel && !hiddenLevels.includes(activeLevel) ? activeLevel : null;
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-5 pt-3">
        <h2 className="text-sm font-semibold">日志上报量</h2>
        <span className="text-xs text-base-content/70">
          每 {intervalLabel(data.intervalSeconds)}
        </span>
      </div>
      <div ref={ref} className="px-4">
        <ChartContainer
          config={config}
          className="h-28 w-full aspect-auto overflow-visible [&_.recharts-cartesian-grid_line]:stroke-base-content/10 [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-base-content/6"
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
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              ticks={chartTicks(points, width)}
              {...timeAxis((value) =>
                timeTickLabel(String(value), Date.parse(to) - Date.parse(from)),
              )}
            />
            <YAxis allowDecimals={false} {...valueAxis({ unit: "条" })} />
            <ChartTooltip
              wrapperStyle={{ zIndex: 50 }}
              content={
                <ChartTooltipContent
                  className="gap-2 rounded-box border-base-300 bg-base-100/95 px-3 py-2.5 shadow-sm backdrop-blur-sm"
                  labelClassName="text-xs font-normal text-base-content/85"
                  indicator="line"
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
                  hide={hiddenLevels.includes(key)}
                  fillOpacity={highlightedLevel && highlightedLevel !== key ? 0.25 : 1}
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
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-3 pt-1 text-[11px] text-base-content/70"
        aria-label="日志级别图例"
      >
        {logLevels.map((key) => (
          <li key={key}>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-selector py-1 transition-colors hover:text-base-content focus-visible:text-base-content focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none"
              aria-pressed={!hiddenLevels.includes(key)}
              onMouseEnter={() => setHoveredLevel(key)}
              onMouseLeave={() => setHoveredLevel(null)}
              onFocus={() => setFocusedLevel(key)}
              onBlur={() => setFocusedLevel(null)}
              onClick={() =>
                setHiddenLevels((hidden) =>
                  hidden.includes(key) ? hidden.filter((level) => level !== key) : [...hidden, key],
                )
              }
            >
              <span
                className={`size-1.5 rounded-selector ${hiddenLevels.includes(key) ? "opacity-30" : "opacity-80"}`}
                style={{ background: colors[key] }}
                aria-hidden="true"
              />
              <span className={hiddenLevels.includes(key) ? "line-through" : undefined}>
                {key.toUpperCase()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
