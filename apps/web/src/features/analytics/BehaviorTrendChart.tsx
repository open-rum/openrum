import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BehaviorTrendPoint } from "./types";

export function BehaviorTrendChart({ data }: { data: BehaviorTrendPoint[] }) {
  const points = data.map((point) => ({
    time: new Date(point.bucket).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    events: point.metric.events,
    users: point.metric.uniqueUsers,
  }));
  return (
    <div className="behavior-chart" aria-label="行为事件和用户趋势">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={220}
        initialDimension={{ width: 760, height: 280 }}
      >
        <AreaChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: -8 }}>
          <defs>
            {/* Citrus fills come from --ds-primary, which holds its lightness in
                both modes; --ds-brand is darkened for text contrast in light
                mode and turns the band olive. See docs/design.md. */}
            <linearGradient id="behaviorEvents" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ds-primary)" stopOpacity={0.38} />
              <stop offset="100%" stopColor="var(--ds-primary)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--ds-text-muted)", fontSize: 11 }}
            minTickGap={42}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--ds-text-muted)", fontSize: 11 }}
            width={52}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid var(--ds-border)",
              borderRadius: 8,
              background: "var(--ds-surface)",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="events"
            name="事件"
            stroke="var(--ds-primary)"
            strokeWidth={2}
            fill="url(#behaviorEvents)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="users"
            name="用户"
            stroke="var(--ds-info)"
            strokeWidth={1.5}
            fill="transparent"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
