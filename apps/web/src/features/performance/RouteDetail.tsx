import { ArrowLeftIcon, Clock3Icon, MonitorSmartphoneIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  type PerformanceResponse,
  type PerformancePercentile,
  type PerformanceMetricName,
  performanceMetricNames,
} from "@/lib/api/performance";
import { VitalTrendChart } from "./PerformanceOverview";
import { formatTrendDate } from "./trendTime";
import { deviceLabel } from "@/features/filters/dimensionLabels";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { PercentileSelect } from "./PerformanceControls";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Detail = NonNullable<PerformanceResponse["detail"]>;

export function RouteDetail({
  detail,
  percentile,
  onBack,
  onPercentileChange,
  onMetricChange,
}: {
  detail: Detail;
  percentile: PerformancePercentile;
  onBack: () => void;
  onPercentileChange: (value: PerformancePercentile) => void;
  onMetricChange: (value: PerformanceMetricName) => void;
}) {
  const animate = useChartMotion();
  const trend = detail.trend.map((point) => ({
    bucket: point.bucket,
    lcp: point.metric,
    inp: point.metric,
    cls: point.metric,
    fcp: point.metric,
    ttfb: point.metric,
  }));
  const distribution = detail.distribution.map((bucket) => ({
    ...bucket,
    label: bucket.overflow
      ? `≥ ${formatPerformanceMetric(bucket.from, detail.metric)}`
      : `${formatPerformanceMetric(bucket.from, detail.metric)} – ${formatPerformanceMetric(bucket.to, detail.metric)}`,
  }));
  return (
    <div className="performance-detail">
      <button type="button" className="issue-back-link" onClick={onBack}>
        <ArrowLeftIcon />
        返回 Route 列表
      </button>
      <div className="performance-detail__title">
        <div>
          <Badge variant="outline">{detail.metric}</Badge>
          <h2>{detail.route}</h2>
          <p>当前路由与侧栏条件共同生效。返回列表仅移除路由条件。</p>
          <ToggleGroup
            type="single"
            variant="outline"
            value={detail.metric}
            aria-label="路由分析指标"
            onValueChange={(value) => {
              if (value) onMetricChange(value as PerformanceMetricName);
            }}
          >
            {performanceMetricNames.map((name) => (
              <ToggleGroupItem key={name} value={name}>
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <div className="performance-analysis-grid">
        <Card>
          <CardHeader>
            <CardTitle>{percentile.toUpperCase()} 趋势</CardTitle>
            <CardDescription>每个时间桶独立计算，空缺不补零。</CardDescription>
            <PercentileSelect value={percentile} onChange={onPercentileChange} />
          </CardHeader>
          <CardContent>
            <VitalTrendChart trend={trend} metric={detail.metric} percentile={percentile} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>真实用户分布</CardTitle>
            <CardDescription>
              柱高为样本数，横轴为数值区间；≥ 标识包含所有更大值。仅统计保留期内的原始事件。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {distribution.length ? (
              <ChartContainer
                className="performance-metric-trend"
                config={{ samples: { label: "样本数", color: "var(--ds-chart-2)" } }}
                initialDimension={{ width: 360, height: 176 }}
                role="img"
                aria-label={`${detail.metric} 样本分布`}
              >
                <BarChart accessibilityLayer data={distribution}>
                  <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" />
                  <XAxis
                    dataKey="from"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={30}
                    tickFormatter={(value) =>
                      `${distribution.find((bucket) => bucket.from === value)?.overflow ? "≥ " : ""}${formatPerformanceMetric(value, detail.metric)}`
                    }
                  />
                  <YAxis allowDecimals={false} width={40} axisLine={false} tickLine={false} />
                  <ChartTooltip
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as
                        (typeof distribution)[number] | undefined;
                      return active && point ? (
                        <div className="performance-chart-tooltip">
                          <strong>{point.label}</strong>
                          <span>{point.samples} 个样本</span>
                        </div>
                      ) : null;
                    }}
                  />
                  <Bar
                    dataKey="samples"
                    fill="var(--color-samples)"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={animate}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="performance-scope-note">当前范围没有原始分布样本。</p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="performance-facets-grid">
        <FacetCard
          title="浏览器"
          values={detail.browsers}
          metric={detail.metric}
          percentile={percentile}
        />
        <FacetCard
          title="设备类型"
          values={detail.deviceTypes}
          metric={detail.metric}
          percentile={percentile}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>最慢样本</CardTitle>
          <CardDescription>
            保留期内最慢的 25 个原始事件；不代表全部用户的体验。切换分位数不改变原始样本排序。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>指标</TableHead>
                <TableHead>页面</TableHead>
                <TableHead>浏览器 / 设备</TableHead>
                <TableHead>版本</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.samples.map((sample) => (
                <TableRow key={sample.eventId}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <Clock3Icon className="size-3" />
                      {formatTrendDate(sample.timestamp, true)}
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold tabular-nums">
                    {formatPerformanceMetric(sample.value, detail.metric)}
                  </TableCell>
                  <TableCell>
                    <code className="block max-w-80 truncate" title={sample.pageUrl}>
                      {sample.pageUrl}
                    </code>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <MonitorSmartphoneIcon className="size-3" />
                      {[sample.browser, sample.deviceType && deviceLabel(sample.deviceType)]
                        .filter(Boolean)
                        .join(" · ") || "未知"}
                    </span>
                  </TableCell>
                  <TableCell>{sample.release || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!detail.samples.length ? (
            <p className="performance-scope-note">
              没有匹配的原始事件；聚合数据与原始事件保留期可能不同。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function FacetCard({
  title,
  values,
  metric,
  percentile,
}: {
  title: string;
  values: Detail["browsers"];
  metric: Detail["metric"];
  percentile: PerformancePercentile;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          样本量和 {percentile.toUpperCase()} 对比，遵循当前所有筛选。
        </CardDescription>
      </CardHeader>
      <CardContent className="performance-facets">
        {values.map((item) => (
          <div key={item.value}>
            <span>{title === "设备类型" ? deviceLabel(item.value) : item.value || "未知"}</span>
            <strong>{formatPerformanceMetric(item.metric[percentile] ?? null, metric)}</strong>
            <small>{item.metric.samples} 样本</small>
            {!item.metric.sufficient ? <Badge variant="outline">数据不足</Badge> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
