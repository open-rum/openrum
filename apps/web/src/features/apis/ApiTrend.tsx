import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { formatAPIDuration, type APITrendPoint } from "@/lib/api/apis";

const trendTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// All three series are request counts, so they stack on one scale and the
// bands add up to the bucket's traffic. Successes carry the identity hue.
const config = {
  successes: { label: "成功", color: "var(--ds-primary)" },
  clientErrors: { label: "4xx", color: "var(--ds-warning)" },
  failures: { label: "失败", color: "var(--ds-danger)" },
} satisfies ChartConfig;

// Failures sit at the bottom of the stack, against the axis: at a couple of
// percent of traffic their band is only a pixel or two tall, and a fixed
// baseline is the only way a change in it is perceptible. They are also
// stroke-less, because three stacked strokes inside three pixels read as one
// misleading red outline over the whole chart. Only the success band is
// stroked, which puts a crisp line on total requests.
const bands = [
  { key: "failures", top: 0.95, bottom: 0.6, stroke: 0 },
  { key: "clientErrors", top: 0.9, bottom: 0.5, stroke: 0 },
  { key: "successes", top: 0.8, bottom: 0.08, stroke: 1.5 },
] as const;

/**
 * A stacked composition of one bucket's requests. Earlier revisions overlaid
 * counts, milliseconds and a percentage on twin axes, which made the vertical
 * distance between series meaningless. Keeping the panel to a single unit
 * removes the second axis entirely; P95 and the failure rate stay in the
 * tooltip, the summary cards and the endpoint table.
 */
export function ApiTrend({
  trend,
  label,
  size = "sm",
}: {
  trend: readonly APITrendPoint[];
  label: string;
  size?: "sm" | "lg";
}) {
  const animate = useChartMotion();
  if (!trend.length) return <p className="api-trend-empty">当前范围暂无趋势数据。</p>;
  const data = trend.map((point) => ({
    bucket: point.bucket,
    // 4xx is excluded from the failure rate, so it cannot be double counted in
    // the success band either.
    successes: Math.max(0, point.requests - point.failures - point.clientErrors),
    clientErrors: point.clientErrors,
    failures: point.failures,
    requests: point.requests,
    p95: point.p95,
  }));
  return (
    <ChartContainer
      className="api-trend"
      config={config}
      data-size={size}
      initialDimension={{ width: 600, height: size === "lg" ? 300 : 200 }}
      role="img"
      aria-label={`${label}请求量与失败构成趋势`}
    >
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {bands.map((band) => (
            <linearGradient key={band.key} id={`apiTrend-${band.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${band.key})`} stopOpacity={band.top} />
              <stop offset="95%" stopColor={`var(--color-${band.key})`} stopOpacity={band.bottom} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
        <XAxis
          dataKey="bucket"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value: string) => trendTimeFormatter.format(new Date(value))}
        />
        <YAxis axisLine={false} tickLine={false} width={52} tickMargin={6} tickFormatter={count} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              /* P95 rides along in the label because it is worth reading per
                 bucket but cannot be a band on a scale of counts. */
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!point) return "";
                return `${trendTimeFormatter.format(new Date(point.bucket))} · P95 ${formatAPIDuration(point.p95)}`;
              }}
              formatter={(value, name, item) => {
                const point = item?.payload as (typeof data)[number] | undefined;
                const share =
                  point?.requests && typeof value === "number"
                    ? ` · ${((value / point.requests) * 100).toFixed(1)}%`
                    : "";
                return (
                  <span className="api-trend-tip-row">
                    <span>{config[name as keyof typeof config]?.label ?? name}</span>
                    <span>
                      {Number(value).toLocaleString()}
                      {share}
                    </span>
                  </span>
                );
              }}
            />
          }
        />
        {bands.map((band) => (
          <Area
            key={band.key}
            dataKey={band.key}
            type="natural"
            stackId="requests"
            stroke={`var(--color-${band.key})`}
            fill={`url(#apiTrend-${band.key})`}
            strokeWidth={band.stroke}
            isAnimationActive={animate}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

function count(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `${value}`;
}
