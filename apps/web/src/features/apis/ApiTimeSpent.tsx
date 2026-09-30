import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  BAR_RADIUS_TRAILING,
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { apiFailureRate, formatAPIDuration, type APIsResponse } from "@/lib/api/apis";

type Endpoint = APIsResponse["endpoints"][number];

const config = {
  weight: { label: "耗时权重", color: "var(--ds-primary)" },
} satisfies ChartConfig;

const topCount = 8;

/**
 * Ranks endpoints by volume times P95, the same weight the "impact" sort uses.
 * The point is concentration rather than an absolute duration: the slowest
 * endpoint is often not where the time goes, because a fast endpoint called
 * orders of magnitude more often outweighs it.
 */
export function ApiTimeSpent({
  endpoints,
  onSelect,
}: {
  endpoints: readonly Endpoint[];
  onSelect: (endpoint: Endpoint) => void;
}) {
  const animate = useChartMotion();
  const weighted = endpoints
    .filter((endpoint) => endpoint.p95 !== null && endpoint.estimated > 0)
    .map((endpoint) => ({
      endpoint,
      label: shortLabel(endpoint),
      weight: endpoint.estimated * (endpoint.p95 as number),
    }))
    .sort((left, right) => right.weight - left.weight);
  if (!weighted.length) return <p className="api-trend-empty">当前范围没有可比较的 endpoint。</p>;
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  const points = weighted.slice(0, topCount).map((item) => ({
    ...item,
    share: total ? (item.weight / total) * 100 : 0,
  }));
  const leader = points[0];
  return (
    <div className="api-time-spent">
      <ChartContainer
        config={config}
        initialDimension={{ width: 520, height: 240 }}
        role="img"
        aria-label="endpoint 耗时权重排行"
      >
        <BarChart
          data={points}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            width={150}
            tickMargin={6}
          />
          <ChartTooltip
            cursor={{ fill: "var(--ds-surface-subtle)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
              if (!active || !point) return null;
              return (
                <div className="api-chart-tooltip">
                  <strong>
                    {point.endpoint.method} {point.endpoint.url}
                  </strong>
                  <span>占总耗时 {point.share.toFixed(1)}%</span>
                  <span>
                    {Math.round(point.endpoint.estimated).toLocaleString()} 请求 × P95{" "}
                    {formatAPIDuration(point.endpoint.p95)}
                  </span>
                  <span>失败率 {apiFailureRate(point.endpoint).toFixed(2)}%</span>
                </div>
              );
            }}
          />
          <Bar
            dataKey="weight"
            radius={BAR_RADIUS_TRAILING}
            isAnimationActive={animate}
            onClick={(point: unknown) => {
              const payload = point as { payload?: (typeof points)[number] } | undefined;
              if (payload?.payload) onSelect(payload.payload.endpoint);
            }}
          >
            {points.map((point) => (
              <Cell
                key={`${point.endpoint.method}:${point.endpoint.url}`}
                fill={point.endpoint.sufficient ? "var(--color-weight)" : "var(--ds-border)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <p className="api-time-spent-note">
        <code>
          {leader.endpoint.method} {leader.endpoint.url}
        </code>{" "}
        占当前范围总耗时的 {leader.share.toFixed(1)}%
        {weighted.length > topCount ? `，共 ${weighted.length.toLocaleString()} 个 endpoint` : ""}。
      </p>
    </div>
  );
}

/** Keeps the path, which is what distinguishes endpoints, and drops the origin. */
function shortLabel(endpoint: Endpoint) {
  let path = endpoint.url;
  try {
    path = new URL(endpoint.url).pathname;
  } catch {
    // A normalized URL is not always absolute; the raw value is the best label.
  }
  const label = `${endpoint.method} ${path}`;
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}
