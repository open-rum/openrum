import { Bar, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import type { PlotData } from "./adapters";
import type { StatAppearance } from "./model";
import { isolatedDot } from "./isolatedDot";

/** A small view of the same buckets used by the full-size details chart. */
export function StatTrend({
  data,
  appearance,
}: {
  data?: PlotData;
  appearance: Exclude<StatAppearance, "plain">;
}) {
  const animate = useChartMotion();
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
  const common = {
    ...smoothCurve,
    dataKey: series.key,
    stroke: series.ink,
    strokeWidth: 2,
    connectNulls: false,
    dot: isolatedDot(data, series.key, series.ink, 2),
    activeDot: false as const,
    isAnimationActive: animate,
    animationDuration: 350,
  };
  return (
    <ChartContainer
      config={{ [series.key]: { label: series.label, color: series.ink } }}
      className="pointer-events-none h-20 w-full min-w-0 aspect-auto"
      initialDimension={{ width: 130, height: 80 }}
      aria-hidden="true"
      inert
    >
      <ComposedChart
        data={data.rows}
        margin={{ top: 6, right: 6, bottom: 6, left: 6 }}
        barCategoryGap="30%"
        accessibilityLayer={false}
        tabIndex={-1}
      >
        <XAxis dataKey="label" hide />
        <YAxis hide domain={[0, "auto"]} />
        {appearance === "bar-right" ? (
          <Bar
            dataKey={series.key}
            fill={series.color}
            radius={[2, 2, 0, 0]}
            maxBarSize={8}
            isAnimationActive={animate}
            animationDuration={350}
          />
        ) : (
          <Line {...common} />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}
