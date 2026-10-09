import { useId } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import type { PlotData } from "./adapters";
import type { StatAppearance } from "./model";
import { isolatedDot } from "./isolatedDot";

/**
 * A small right-side area of the same buckets used by the full-size details chart: a smooth
 * line over a soft fill that fades to the baseline. Gaps stay gaps.
 */
export function StatTrend({
  data,
}: {
  data?: PlotData;
  appearance?: Exclude<StatAppearance, "plain">;
}) {
  const animate = useChartMotion();
  const gradientId = `stat-area-${useId().replace(/:/g, "")}`;
  const series = data?.series[0];
  const points =
    series && data
      ? data.rows.filter(
          (row) => typeof row[series.key] === "number" && Number.isFinite(row[series.key]),
        )
      : [];
  if (!data || data.empty || !series || !points.length) {
    return (
      <div
        className="relative flex h-20 min-w-0 items-center justify-center text-xs text-muted-foreground"
        role="status"
      >
        暂无趋势数据
      </div>
    );
  }
  return (
    <ChartContainer
      config={{ [series.key]: { label: series.label, color: series.ink } }}
      className="pointer-events-none h-20 w-full min-w-0 aspect-auto"
      initialDimension={{ width: 130, height: 80 }}
      aria-hidden="true"
      inert
    >
      <AreaChart
        data={data.rows}
        margin={{ top: 6, right: 6, bottom: 2, left: 6 }}
        accessibilityLayer={false}
        tabIndex={-1}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series.color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={series.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" hide />
        <YAxis hide domain={[0, "auto"]} />
        <Area
          {...smoothCurve}
          dataKey={series.key}
          stroke={series.ink}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          connectNulls={false}
          dot={isolatedDot(data, series.key, series.ink, 2)}
          activeDot={false}
          isAnimationActive={animate}
          animationDuration={350}
        />
      </AreaChart>
    </ChartContainer>
  );
}
