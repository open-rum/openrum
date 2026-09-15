import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps, TooltipValueType } from "recharts";
import { trendData } from "../data/mock";

type SparklineProps = {
  values: number[];
  tone?: "bad" | "warn" | "good";
};

const sparkColors = {
  bad: "var(--ds-danger)",
  warn: "var(--ds-warning)",
  good: "var(--ds-success)",
};

export function Sparkline({ values, tone = "bad" }: SparklineProps) {
  const data = values.map((value, index) => ({ index, value }));
  return (
    <div className="sparkline" aria-hidden="true">
      <LineChart
        width={45}
        height={20}
        data={data}
        margin={{ top: 2, right: 1, bottom: 2, left: 1 }}
      >
        <Line
          type="monotone"
          dataKey="value"
          stroke={sparkColors[tone]}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}

function formatTooltipValue(value: TooltipValueType | undefined) {
  if (Array.isArray(value)) return value.join("–");
  if (typeof value === "number") return value.toLocaleString();
  return value ?? "0";
}

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__time">2026-09-02 {label}</div>
      {label === "14:20" && <div className="chart-tooltip__release">● 发布 v2.18.0</div>}
      {payload.map((entry) => (
        <div className="chart-tooltip__row" key={String(entry.dataKey)}>
          <span>
            <span style={{ color: entry.color }} aria-hidden="true">
              ●
            </span>{" "}
            {entry.name}
          </span>
          <strong>
            {entry.dataKey === "errorRate"
              ? `${entry.value}%`
              : `${formatTooltipValue(entry.value)}K`}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function QualityTrend({ compare }: { compare: boolean }) {
  return (
    <div className="quality-chart" aria-label="访问量与稳定性趋势图">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={120}
        initialDimension={{ width: 720, height: 188 }}
      >
        <LineChart data={trendData} margin={{ top: 14, right: 4, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="pvWash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ds-chart-1)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--ds-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--ds-border-soft)" strokeDasharray="2 3" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: "var(--ds-text-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="traffic"
            domain={[0, 850]}
            ticks={[0, 200, 400, 600, 800]}
            tickFormatter={(value) => (value === 0 ? "0" : `${value}K`)}
            tick={{ fill: "var(--ds-text-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 2.5]}
            ticks={[0, 0.5, 1, 1.5, 2]}
            tickFormatter={(value) => `${value}%`}
            tick={{ fill: "var(--ds-text-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={(props) => <TrendTooltip {...props} />}
            cursor={{ stroke: "var(--ds-border)", strokeDasharray: "3 3" }}
          />
          <ReferenceLine
            x="14:20"
            yAxisId="traffic"
            stroke="var(--ds-border)"
            strokeDasharray="3 3"
            label={{
              value: "v2.18.0",
              position: "top",
              fill: "var(--ds-text-muted)",
              fontSize: 11,
            }}
          />
          {compare && (
            <Area
              yAxisId="traffic"
              type="monotone"
              dataKey="pv"
              name="较昨日 PV"
              stroke="transparent"
              fill="url(#pvWash)"
              isAnimationActive={false}
            />
          )}
          <Line
            yAxisId="traffic"
            type="monotone"
            dataKey="pv"
            name="PV"
            stroke="var(--ds-chart-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
          <Line
            yAxisId="traffic"
            type="monotone"
            dataKey="uv"
            name="UV"
            stroke="var(--ds-info)"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="errorRate"
            name="错误率"
            stroke="var(--ds-danger)"
            strokeWidth={1.6}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
