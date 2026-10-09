import { Line, LineChart, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { isolatedDot } from "./isolatedDot";
import { smoothCurve } from "./smoothCurve";
import { useChartMotion } from "./useChartMotion";

/**
 * A row-sized trend: the same buckets as the full chart, drawn without axes, tooltip or
 * pointer interaction. Gaps stay gaps and an isolated sample shows as a dot. Exact values
 * belong to the enlarged details, which is why this is hidden from assistive technology.
 */
export function Sparkline({
  values,
  color,
  className = "h-8 w-24",
}: {
  values: Array<number | null>;
  color: string;
  className?: string;
}) {
  const animate = useChartMotion();
  const rows = values.map((value, index) => ({ label: String(index), value }));
  if (!values.some((value) => typeof value === "number" && Number.isFinite(value))) {
    return <span className={`${className} inline-block`} aria-hidden="true" />;
  }
  return (
    <ChartContainer
      config={{ value: { label: "trend", color } }}
      className={`pointer-events-none aspect-auto ${className}`}
      initialDimension={{ width: 96, height: 32 }}
      aria-hidden="true"
      inert
    >
      <LineChart
        data={rows}
        margin={{ top: 3, right: 3, bottom: 3, left: 3 }}
        accessibilityLayer={false}
      >
        <YAxis hide domain={["auto", "auto"]} />
        <Line
          {...smoothCurve}
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={isolatedDot({ rows }, "value", color, 1.5)}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={animate}
          animationDuration={350}
        />
      </LineChart>
    </ChartContainer>
  );
}
