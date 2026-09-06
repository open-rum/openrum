import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { OverviewResponse } from "@/lib/api/client";

type MetricCardsProps =
  { data: OverviewResponse; loading?: false } | { data?: undefined; loading: true };

export function MetricCards(props: MetricCardsProps) {
  if (props.loading) {
    return (
      <section
        className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"
        aria-label="正在加载核心指标"
      >
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton className="h-36" key={index} />
        ))}
      </section>
    );
  }
  const { kpis, comparison } = props.data;
  const metrics = [
    {
      label: "PV",
      value: compact(kpis.pageViews.value),
      detail: `${kpis.pageViews.samples.toLocaleString()} 个采集样本`,
      delta: percent(comparison.changes.pageViewsPercent),
    },
    {
      label: "UV",
      value: compact(kpis.uniqueUsers.value),
      detail: `${kpis.uniqueUsers.samples.toLocaleString()} 个会话样本 · 近似`,
      delta: percent(comparison.changes.uniqueUsersPercent),
    },
    {
      label: "错误率",
      value: rate(kpis.errorRate.value),
      detail: `${compact(kpis.errorRate.numerator)} 错误 / ${compact(kpis.errorRate.denominator)} PV`,
      delta: points(comparison.changes.errorRatePoints),
    },
    {
      label: "API 失败率",
      value: rate(kpis.apiFailureRate.value),
      detail: `${kpis.apiFailureRate.numeratorSamples.toLocaleString()} 失败 / ${kpis.apiFailureRate.denominatorSamples.toLocaleString()} 请求`,
      delta: points(comparison.changes.apiFailureRatePoints),
    },
    {
      label: "LCP P75",
      value: duration(kpis.lcp.p75),
      detail: `${kpis.lcp.samples.toLocaleString()} 个样本`,
      delta: percent(comparison.changes.lcpPercent),
      low: !kpis.lcp.sufficient,
    },
    {
      label: "INP P75",
      value: duration(kpis.inp.p75),
      detail: `${kpis.inp.samples.toLocaleString()} 个样本`,
      delta: percent(comparison.changes.inpPercent),
      low: !kpis.inp.sufficient,
    },
    {
      label: "CLS P75",
      value: decimal(kpis.cls.p75),
      detail: `${kpis.cls.samples.toLocaleString()} 个样本`,
      delta: percent(comparison.changes.clsPercent),
      low: !kpis.cls.sufficient,
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" aria-label="核心指标">
      {metrics.map((metric) => (
        <Card size="sm" key={metric.label}>
          <CardHeader>
            <CardTitle>{metric.label}</CardTitle>
            <CardDescription>{metric.detail}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto flex flex-col gap-2">
            <strong className="text-2xl font-semibold tracking-tight tabular-nums">
              {metric.value}
            </strong>
            <div className="flex items-center gap-2">
              <Badge variant={metric.low ? "outline" : "secondary"}>
                {metric.low ? "样本不足" : metric.delta}
              </Badge>
              <span className="text-xs text-muted-foreground">较上一周期</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(
    value,
  );
}
function rate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}
function duration(value: number | null) {
  return value === null
    ? "—"
    : value >= 1000
      ? `${(value / 1000).toFixed(2)}s`
      : `${Math.round(value)}ms`;
}
function decimal(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}
function percent(value: number | null) {
  return value === null ? "无对比" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function points(value: number | null) {
  return value === null ? "无对比" : `${value > 0 ? "+" : ""}${value.toFixed(2)}pp`;
}
