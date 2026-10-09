import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatPerformanceMetric,
  performancePercentiles,
  type PerformanceMetricName,
  type PerformanceMetricKey,
  type PerformancePercentile,
  type PerformanceResponse,
} from "@/lib/api/performance";
import {
  overallPerformanceScore,
  performanceRating,
  performanceScore,
  performanceThresholds,
  ratingLabel,
  scoreRating,
} from "./score";
import { formatTrendDate } from "./trendTime";
import { CombinedVitalTrend } from "./CombinedVitalTrend";
import { PerformanceScoreRing } from "./PerformanceScoreRing";
import { vitalSeries } from "./combinedTrend";

const metricDescriptions = {
  LCP: "主要内容加载",
  INP: "交互响应",
  CLS: "视觉稳定性",
  FCP: "首次内容绘制",
  TTFB: "首字节响应",
};

export function PerformanceOverview({
  summary,
  trend,
  range,
  percentile,
  onPercentileChange,
}: {
  summary: PerformanceResponse["summary"];
  trend: PerformanceResponse["trend"];
  range?: { from?: string; to?: string; intervalSeconds?: number };
  percentile: PerformancePercentile;
  onPercentileChange: (value: PerformancePercentile) => void;
}) {
  const scoring = overallPerformanceScore(summary);
  return (
    <section className="performance-summary" aria-label="性能指标概览">
      <div className="performance-overview-top">
        <PerformanceScoreCard scoring={scoring} />
        <CombinedVitalTrend
          trend={trend}
          range={range}
          percentile={percentile}
          onPercentileChange={onPercentileChange}
        />
      </div>
      <div className="performance-summary-stats">
        {vitalSeries.map(({ key, name }) => {
          const metric = summary?.[key];
          const rating = performanceRating(metric?.sufficient ? metric.p75 : null, name);
          const score = metric && metric.samples > 0 ? performanceScore(metric.p75, name) : null;
          return (
            <Card key={name} className="performance-metric-card" size="sm">
              <CardHeader>
                <CardTitle>
                  {name}{" "}
                  <span className="performance-metric-percentile">{percentile.toUpperCase()}</span>
                </CardTitle>
                <CardDescription>{metricDescriptions[name]}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="performance-metric-value">
                  <strong>{formatPerformanceMetric(metric?.[percentile] ?? null, name)}</strong>
                  <span>{(metric?.samples ?? 0).toLocaleString()} 样本</span>
                </div>
              </CardContent>
              <CardFooter className="performance-metric-footer" data-rating={rating}>
                {metric?.sufficient
                  ? `P75 ${ratingLabel(rating)} · ${score ?? "—"} 分`
                  : (metric?.samples ?? 0) > 0
                    ? "样本不足 · 暂不判定"
                    : "暂无数据"}
              </CardFooter>
            </Card>
          );
        })}
      </div>
      <details className="performance-score-method">
        <summary>评分口径与分位数对比</summary>
        <p>
          P50 看典型体验，P75 用于体验判定，P95 看长尾。图表展示原始值：耗时共用左侧毫秒轴，CLS
          使用右侧无单位轴； 两轴独立缩放，曲线高低不可跨轴比较。时间桶缺失不补零。
          整体值按当前筛选下保留期内的原始样本计算，不是路由分位数的平均；更长时间范围可能缺少历史样本。
        </p>
        <p>
          性能评分沿用 OpenRUM 原有 0–100 分曲线：良好阈值为 90 分，较差阈值为 50
          分，再分段线性变化。整体 P75 分别评分后按 Sentry 默认权重加权：
          {scoring.metrics.map(({ name, weight }) => `${name} ${weight}%`).join("、")}。
          环段大小表示默认权重，彩色长度表示单项得分比例，灰色为剩余部分。
          切换分位数或隐藏曲线不会改变评分。
          缺失项保留灰色环段，不填零或满分；总分按可用项权重重新归一。五项不全或任一项少于 75
          个样本时仅显示参考评分。仅权重参考 Sentry，不采用其对数正态评分模型。 此分数不是 Sentry 或
          Lighthouse 分数，也不等于 CWV 达标结论；建议分别筛选电脑与手机查看。
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>指标</TableHead>
              {performancePercentiles.map((p) => (
                <TableHead key={p}>{p.toUpperCase()}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {vitalSeries.map(({ key, name }) => (
              <TableRow key={name}>
                <TableCell>{name}</TableCell>
                {performancePercentiles.map((p) => (
                  <TableCell key={p}>
                    {formatPerformanceMetric(summary?.[key]?.[p] ?? null, name)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </section>
  );
}

function PerformanceScoreCard({
  scoring,
}: {
  scoring: ReturnType<typeof overallPerformanceScore>;
}) {
  const rating = scoreRating(scoring.score);
  return (
    <Card className="performance-summary-score" size="sm">
      <CardHeader>
        <div>
          <CardTitle>性能评分</CardTitle>
          <CardDescription>加权评分 · P75</CardDescription>
        </div>
        <Badge variant="outline">
          {scoring.score === null
            ? "暂无数据"
            : scoring.complete
              ? ratingLabel(rating)
              : "参考评分"}
        </Badge>
      </CardHeader>
      <CardContent>
        <PerformanceScoreRing scoring={scoring} />
        {!scoring.complete ? (
          <p>
            {scoring.available}/{scoring.metrics.length} 项有数据 · 仅供参考
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// The project dashboard also consumes this chart with its P75-only response.
type TrendMetric = { p75: number | null; samples: number } & Partial<
  Record<PerformancePercentile, number | null>
>;
export function VitalTrendChart({
  trend,
  metric,
  percentile = "p75",
}: {
  trend: readonly {
    bucket: string;
    lcp: TrendMetric;
    inp: TrendMetric;
    cls: TrendMetric;
    fcp?: TrendMetric;
    ttfb?: TrendMetric;
  }[];
  metric: PerformanceMetricName;
  percentile?: PerformancePercentile;
}) {
  const animate = useChartMotion();
  const key = metric.toLowerCase() as PerformanceMetricKey;
  const data = trend.map((point) => ({
    bucket: point.bucket,
    value: point[key]?.[percentile] ?? null,
    samples: point[key]?.samples ?? 0,
  }));
  if (!data.some((point) => point.value !== null))
    return <div className="performance-metric-trend-empty">当前范围暂无趋势数据</div>;
  const config = {
    value: { label: `${metric} ${percentile.toUpperCase()}`, color: "var(--ds-chart-1)" },
  } satisfies ChartConfig;
  const threshold = performanceThresholds[metric];
  return (
    <ChartContainer
      className="performance-metric-trend"
      config={config}
      initialDimension={{ width: 360, height: 176 }}
      role="img"
      aria-label={`${metric} ${percentile.toUpperCase()} 日期趋势`}
    >
      <LineChart accessibilityLayer data={data} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
        <XAxis
          dataKey="bucket"
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value) =>
            formatTrendDate(
              value,
              Date.parse(data[data.length - 1].bucket) - Date.parse(data[0].bucket) < 2 * 86400000,
            )
          }
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickMargin={6}
          width={44}
          tickFormatter={(value: number) =>
            metric === "CLS"
              ? value.toFixed(2)
              : value >= 1000
                ? `${(value / 1000).toFixed(1)}s`
                : `${Math.round(value)}`
          }
          domain={[0, "auto"]}
        />
        {percentile === "p75" ? (
          <>
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
          </>
        ) : null}
        <ChartTooltip
          cursor={{ stroke: "var(--ds-border)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!active || !point) return null;
            return (
              <div className="performance-chart-tooltip">
                <strong>{formatTrendDate(point.bucket, true)}</strong>
                <span>
                  {formatPerformanceMetric(point.value, metric)} · {percentile.toUpperCase()}
                </span>
                <span>{point.samples.toLocaleString()} 个样本</span>
              </div>
            );
          }}
        />
        <Line
          {...smoothCurve}
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={data.length === 1}
          activeDot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={animate}
        />
      </LineChart>
    </ChartContainer>
  );
}
