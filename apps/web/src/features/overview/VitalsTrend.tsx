import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VitalTrendChart } from "@/features/performance/PerformanceOverview";
import { performanceRating, ratingLabel } from "@/features/performance/score";
import type { PerformanceMetricName } from "@/lib/api/performance";
import type { OverviewResponse } from "@/lib/api/client";

const metrics = ["LCP", "INP", "CLS"] as const satisfies readonly PerformanceMetricName[];

/**
 * The overview endpoint already returns a P75 per vital per bucket; before this
 * panel the dashboard only showed the range-wide value, so a regression was
 * invisible until someone opened the performance workspace.
 *
 * Each vital keeps its own panel and native unit. LCP and INP are milliseconds
 * and CLS is an unitless score, so a shared axis would make the vertical
 * distance between them arbitrary.
 */
export function VitalsTrend({
  series,
  kpis,
}: {
  series: OverviewResponse["series"];
  kpis: OverviewResponse["kpis"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Core Web Vitals 趋势</CardTitle>
        <CardDescription>
          每个指标保留自己的单位与坐标轴；虚线是 Google 的达标与不佳阈值。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => {
          const kpi = kpis[metric.toLowerCase() as "lcp" | "inp" | "cls"];
          const rating = performanceRating(kpi.p75, metric);
          return (
            <section key={metric} aria-label={`${metric} P75 趋势`}>
              <div className="flex items-baseline justify-between gap-2">
                {/* The range-wide P75 is already in the KPI card above, so this
                    header carries only what the card cannot: the verdict and
                    how much data it rests on. */}
                <h3 className="text-sm font-medium text-foreground">{metric} P75</h3>
                <Badge variant="outline">{kpi.sufficient ? ratingLabel(rating) : "样本不足"}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {kpi.samples.toLocaleString()} 个样本
              </p>
              <div className="mt-2">
                <VitalTrendChart trend={series} metric={metric} />
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
