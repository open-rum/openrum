import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  GaugeIcon,
  MousePointerClickIcon,
  MoveIcon,
  PanelTopIcon,
  RouteIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import {
  formatPerformanceMetric,
  type PerformanceMetricName,
  type PerformanceResponse,
} from "@/lib/api/performance";
import {
  performanceRating,
  performanceScore,
  performanceThresholds,
  ratingLabel,
  scoreRating,
  summarizePerformance,
  type PerformanceRating,
} from "./score";

const metricIcons: Record<PerformanceMetricName, LucideIcon> = {
  LCP: PanelTopIcon,
  INP: MousePointerClickIcon,
  CLS: MoveIcon,
};

const ratingIcons: Record<PerformanceRating, LucideIcon> = {
  good: CircleCheckIcon,
  "needs-improvement": CircleAlertIcon,
  poor: CircleXIcon,
  unknown: GaugeIcon,
};

const axisDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});
const tooltipDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function PerformanceOverview({
  routes,
  trend,
  selectedMetric,
}: {
  routes: PerformanceResponse["routes"];
  trend: PerformanceResponse["trend"];
  selectedMetric: PerformanceMetricName;
}) {
  const summary = summarizePerformance(routes);
  const overallRating = scoreRating(summary.score);
  const RatingIcon = ratingIcons[overallRating];
  return (
    <section className="performance-overview" aria-label="性能健康概览">
      <Card className="performance-score-card">
        <CardHeader>
          <div className="performance-card-heading">
            <span className="performance-icon performance-icon--brand">
              <GaugeIcon />
            </span>
            <div>
              <CardTitle>体验健康度</CardTitle>
              <CardDescription>基于三个 Core Web Vitals 的样本加权评分</CardDescription>
            </div>
          </div>
          <Badge
            className={`performance-rating performance-rating--${overallRating}`}
            variant="outline"
          >
            <RatingIcon />
            {ratingLabel(overallRating)}
          </Badge>
        </CardHeader>
        <CardContent className="performance-score-content">
          <ScoreGauge score={summary.score} rating={overallRating} />
          <div className="performance-score-facts">
            <div>
              <RouteIcon />
              <span>已测 Route</span>
              <strong>{summary.measuredRoutes}</strong>
            </div>
            <div>
              <PanelTopIcon />
              <span>页面访问</span>
              <strong>{summary.pageViews.toLocaleString()}</strong>
            </div>
          </div>
          <p>OpenRUM 评分用于排序优化优先级；达标判断遵循 CWV P75 阈值。</p>
        </CardContent>
      </Card>

      <div className="performance-metric-grid">
        {summary.metrics.map((metric) => {
          const Icon = metricIcons[metric.name];
          const rating = performanceRating(metric.p75, metric.name);
          const RatingStatusIcon = ratingIcons[rating];
          const passRate = metric.measuredRoutes
            ? Math.round((metric.goodRoutes / metric.measuredRoutes) * 100)
            : 0;
          return (
            <Card key={metric.name} className="performance-metric-card" size="sm">
              <CardHeader>
                <span className={`performance-icon performance-icon--${rating}`}>
                  <Icon />
                </span>
                <div>
                  <CardTitle>{metric.name} P75</CardTitle>
                  <CardDescription>{metric.samples.toLocaleString()} 个有效样本</CardDescription>
                </div>
                <Badge
                  className={`performance-rating performance-rating--${rating}`}
                  variant="outline"
                >
                  <RatingStatusIcon />
                  {ratingLabel(rating)}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="performance-metric-value">
                  <strong>{formatPerformanceMetric(metric.p75, metric.name)}</strong>
                  <span>{metric.score ?? "—"} 分</span>
                </div>
                <VitalTrendChart trend={trend} metric={metric.name} />
                <div className="performance-pass-rate">
                  <span>Route 达标率</span>
                  <strong>{metric.measuredRoutes ? `${passRate}%` : "—"}</strong>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="performance-route-chart-card">
        <CardHeader>
          <div className="performance-card-heading">
            <span className="performance-icon performance-icon--brand">
              <RouteIcon />
            </span>
            <div>
              <CardTitle>Route 体验评分</CardTitle>
              <CardDescription>按样本量展示主要 Route，分数越低越值得优先排查</CardDescription>
            </div>
          </div>
          <Badge variant="secondary">{selectedMetric}</Badge>
        </CardHeader>
        <CardContent>
          <RouteScoreChart routes={routes} metric={selectedMetric} />
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Shared with the project dashboard. The overview endpoint's series carries the
 * same per-bucket vital shape as the performance trend, so the prop is typed to
 * the common subset rather than to either response.
 */
export function VitalTrendChart({
  trend,
  metric,
}: {
  trend: readonly {
    bucket: string;
    lcp: { p75: number | null; samples: number };
    inp: { p75: number | null; samples: number };
    cls: { p75: number | null; samples: number };
  }[];
  metric: PerformanceMetricName;
}) {
  const animate = useChartMotion();
  const key = metric.toLowerCase() as "lcp" | "inp" | "cls";
  const data = trend
    .filter((point) => point[key].p75 !== null)
    .map((point) => ({
      bucket: point.bucket,
      value: point[key].p75,
      samples: point[key].samples,
    }));
  if (!data.length) {
    return <div className="performance-metric-trend-empty">当前范围暂无趋势数据</div>;
  }
  const config = {
    value: {
      label: `${metric} P75`,
      color: "var(--ds-brand)",
    },
  } satisfies ChartConfig;
  const threshold = performanceThresholds[metric];
  return (
    <ChartContainer
      className="performance-metric-trend"
      config={config}
      initialDimension={{ width: 360, height: 176 }}
      role="img"
      aria-label={`${metric} P75 日期趋势`}
    >
      <LineChart accessibilityLayer data={data} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
        <XAxis
          dataKey="bucket"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatAxisDate}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          // CLS ticks read "0.25", which the narrower width used to clip to
          // ".25" once the poor threshold pushed the domain past 0.1.
          width={44}
          tickFormatter={(value: number) => formatAxisMetric(value, metric)}
          domain={["auto", "auto"]}
        />
        <ReferenceLine
          y={threshold.good}
          stroke="var(--ds-success)"
          strokeDasharray="3 3"
          ifOverflow="extendDomain"
        />
        <ReferenceLine
          y={threshold.poor}
          stroke="var(--ds-danger)"
          strokeDasharray="3 3"
          ifOverflow="extendDomain"
        />
        <ChartTooltip
          cursor={{ stroke: "var(--ds-border)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!active || !point) return null;
            return (
              <div className="performance-chart-tooltip">
                <strong>{formatTooltipDate(point.bucket)}</strong>
                <span>{formatPerformanceMetric(point.value, metric)} P75</span>
                <span>{point.samples.toLocaleString()} 个样本</span>
              </div>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={animate}
        />
      </LineChart>
    </ChartContainer>
  );
}

function ScoreGauge({ score, rating }: { score: number | null; rating: PerformanceRating }) {
  const value = score ?? 0;
  return (
    <div className="performance-score-gauge" aria-label={`体验健康度 ${score ?? "暂无数据"} 分`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={180} minHeight={180}>
        <RadialBarChart
          data={[{ value, fill: ratingColor(rating) }]}
          innerRadius="76%"
          outerRadius="100%"
          startAngle={210}
          endAngle={-30}
          barSize={12}
        >
          <RadialBar dataKey="value" background cornerRadius={8} isAnimationActive={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div>
        <strong>{score ?? "—"}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

function RouteScoreChart({
  routes,
  metric,
}: {
  routes: PerformanceResponse["routes"];
  metric: PerformanceMetricName;
}) {
  const key = metric.toLowerCase() as "lcp" | "inp" | "cls";
  const data = routes
    .filter((route) => route[key].p75 !== null && route[key].samples > 0)
    .sort((left, right) => right[key].samples - left[key].samples)
    .slice(0, 7)
    .map((route) => ({
      route: route.route,
      score: performanceScore(route[key].p75, metric) ?? 0,
      value: route[key].p75,
      samples: route[key].samples,
      rating: performanceRating(route[key].p75, metric),
    }));
  if (!data.length) {
    return <div className="performance-chart-empty">当前指标还没有可绘制的 Route 样本。</div>;
  }
  return (
    <div className="performance-route-chart" role="img" aria-label={`${metric} Route 性能评分排行`}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={260}
        initialDimension={{ width: 840, height: 286 }}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 6, right: 18, bottom: 8, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 50, 90, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--ds-text-muted)", fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="route"
            width={132}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--ds-text-secondary)", fontSize: 12 }}
          />
          <ReferenceLine x={50} stroke="var(--ds-danger)" strokeDasharray="3 3" />
          <ReferenceLine x={90} stroke="var(--ds-success)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: "var(--ds-surface-subtle)" }}
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !item) return null;
              return (
                <div className="performance-chart-tooltip">
                  <strong>{item.route}</strong>
                  <span>
                    {formatPerformanceMetric(item.value, metric)} · {item.samples} 样本
                  </span>
                  <span>
                    {item.score} 分 · {ratingLabel(item.rating)}
                  </span>
                </div>
              );
            }}
          />
          <Bar dataKey="score" radius={[0, 5, 5, 0]} isAnimationActive={false}>
            {data.map((item) => (
              <Cell key={item.route} fill={ratingColor(item.rating)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ratingColor(rating: PerformanceRating) {
  switch (rating) {
    case "good":
      return "var(--ds-success)";
    case "needs-improvement":
      return "var(--ds-warning)";
    case "poor":
      return "var(--ds-danger)";
    default:
      return "var(--ds-text-muted)";
  }
}

function formatAxisDate(value: string) {
  return axisDateFormatter.format(new Date(value));
}

function formatTooltipDate(value: string) {
  return tooltipDateFormatter.format(new Date(value));
}

function formatAxisMetric(value: number, metric: PerformanceMetricName) {
  if (metric === "CLS") return value.toFixed(2);
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}`;
}
