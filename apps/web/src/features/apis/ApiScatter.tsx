import { CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import {
  apiFailureRate,
  formatAPIDuration,
  minimumAPISamples,
  type APIsResponse,
} from "@/lib/api/apis";

type Endpoint = APIsResponse["endpoints"][number];

const config = {
  endpoints: { label: "Endpoint", color: "var(--ds-primary)" },
} satisfies ChartConfig;

/**
 * Two tones only. A third, middle band turned the plot into a traffic light
 * without telling the reader anything the tooltip does not already say, so the
 * marks stay on the identity colour unless the endpoint is genuinely failing.
 */
const failingRate = 5;

function tone(rate: number) {
  return rate >= failingRate ? "var(--ds-danger)" : "var(--color-endpoints)";
}

/**
 * A sorted table can only rank one column at a time, so an endpoint that is
 * both busy and slow is easy to miss: sorting by P95 promotes rare endpoints
 * and sorting by volume hides slow ones. Plotting volume against P95 puts that
 * trade-off on one surface, and the reference line at the overall P95 splits
 * the endpoints that drag the aggregate from the ones that do not.
 */
export function ApiScatter({
  endpoints,
  overallP95,
  onSelect,
}: {
  endpoints: readonly Endpoint[];
  overallP95: number | null;
  onSelect: (endpoint: Endpoint) => void;
}) {
  const animate = useChartMotion();
  // Both scales are logarithmic, so neither axis can place a zero, and an
  // endpoint without a percentile has no vertical position to take.
  const points = endpoints
    .filter((endpoint) => endpoint.p95 !== null && endpoint.p95 > 0 && endpoint.estimated > 0)
    .map((endpoint) => ({
      endpoint,
      volume: Math.round(endpoint.estimated),
      p95: endpoint.p95 as number,
      rate: apiFailureRate(endpoint),
    }));
  if (!points.length) return <p className="api-trend-empty">当前范围没有可比较的 endpoint。</p>;
  return (
    <ChartContainer
      className="api-scatter"
      config={config}
      initialDimension={{ width: 520, height: 260 }}
      role="img"
      aria-label="endpoint 请求量与 P95 延迟分布"
    >
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
        <XAxis
          type="number"
          dataKey="volume"
          name="请求量"
          scale="log"
          domain={["auto", "auto"]}
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          tickFormatter={formatCount}
        />
        {/* A handful of slow endpoints would otherwise stretch a linear scale
            and squash everything else onto the baseline. */}
        <YAxis
          type="number"
          dataKey="p95"
          name="P95"
          scale="log"
          domain={["auto", "auto"]}
          axisLine={false}
          tickLine={false}
          width={52}
          tickMargin={6}
          tickFormatter={formatLatency}
        />
        {overallP95 === null ? null : (
          <ReferenceLine
            y={overallP95}
            stroke="var(--ds-text-muted)"
            strokeDasharray="4 4"
            label={{
              value: `整体 P95 ${formatAPIDuration(overallP95)}`,
              // Anchored left: the right side of the line is where the
              // high-volume endpoints sit, and the label would cover them.
              position: "insideTopLeft",
              fill: "var(--ds-text-muted)",
              fontSize: 11,
            }}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--ds-border)", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <div className="api-chart-tooltip">
                <strong>
                  {point.endpoint.method} {point.endpoint.url}
                </strong>
                <span>{point.volume.toLocaleString()} 请求（估算）</span>
                <span>P95 {formatAPIDuration(point.p95)}</span>
                <span>失败率 {point.rate.toFixed(2)}%</span>
                {point.endpoint.sufficient ? null : (
                  <span>样本少于 {minimumAPISamples}，分位波动大</span>
                )}
              </div>
            );
          }}
        />
        <Scatter
          data={points}
          isAnimationActive={animate}
          className="api-scatter-series"
          onClick={(point: unknown) => {
            const payload = point as { payload?: (typeof points)[number] } | undefined;
            if (payload?.payload) onSelect(payload.payload.endpoint);
          }}
        >
          {points.map((point) => (
            <Cell
              key={`${point.endpoint.method}:${point.endpoint.url}`}
              // Hollow marks the endpoints whose percentile the page already
              // labels as low-confidence, so the chart cannot imply more
              // precision than the table does.
              fill={point.endpoint.sufficient ? tone(point.rate) : "transparent"}
              stroke={tone(point.rate)}
              strokeWidth={point.endpoint.sufficient ? 0 : 2}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartContainer>
  );
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `${value}`;
}

function formatLatency(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}
