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
import { formatPerformanceMetric, type PerformanceResponse } from "@/lib/api/performance";

type Detail = NonNullable<PerformanceResponse["detail"]>;

export function RouteDetail({ detail, onBack }: { detail: Detail; onBack: () => void }) {
  const maximumTrend = Math.max(1, ...detail.trend.map((point) => point.metric.p75 ?? 0));
  const maximumBucket = Math.max(1, ...detail.distribution.map((bucket) => bucket.samples));
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
          <p>比较趋势、真实用户分布与最慢样本。</p>
        </div>
      </div>
      <div className="performance-analysis-grid">
        <Card>
          <CardHeader>
            <CardTitle>P75 趋势</CardTitle>
            <CardDescription>每个时间桶显示该指标的第 75 百分位。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="performance-trend" role="img" aria-label={`${detail.metric} P75 趋势`}>
              {detail.trend.map((point) => (
                <div key={point.bucket}>
                  <i
                    style={{
                      height: `${Math.max(3, ((point.metric.p75 ?? 0) / maximumTrend) * 100)}%`,
                    }}
                  />
                  <span>{formatPerformanceMetric(point.metric.p75, detail.metric)}</span>
                  <small>
                    {new Date(point.bucket).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>真实用户分布</CardTitle>
            <CardDescription>柱宽代表指标区间，柱高代表样本数。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="performance-distribution" aria-label={`${detail.metric} 样本分布`}>
              {detail.distribution.map((bucket) => (
                <div
                  key={bucket.from}
                  aria-label={`${formatPerformanceMetric(bucket.from, detail.metric)} 到 ${formatPerformanceMetric(bucket.to, detail.metric)}：${bucket.samples} 个样本`}
                >
                  <i
                    style={{ height: `${Math.max(3, (bucket.samples / maximumBucket) * 100)}%` }}
                  />
                  <span>{formatPerformanceMetric(bucket.from, detail.metric)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="performance-facets-grid">
        <FacetCard title="浏览器" values={detail.browsers} metric={detail.metric} />
        <FacetCard title="设备类型" values={detail.deviceTypes} metric={detail.metric} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>最慢样本</CardTitle>
          <CardDescription>打开对应事件，区分普遍退化和少数极端值。</CardDescription>
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
                      {new Date(sample.timestamp).toLocaleString("zh-CN")}
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold tabular-nums">
                    {formatPerformanceMetric(sample.value, detail.metric)}
                  </TableCell>
                  <TableCell>
                    <code>{sample.pageUrl}</code>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <MonitorSmartphoneIcon className="size-3" />
                      {[sample.browser, sample.deviceType].filter(Boolean).join(" · ") || "未知"}
                    </span>
                  </TableCell>
                  <TableCell>{sample.release || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FacetCard({
  title,
  values,
  metric,
}: {
  title: string;
  values: Detail["browsers"];
  metric: Detail["metric"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>样本量和 P75 对比。</CardDescription>
      </CardHeader>
      <CardContent className="performance-facets">
        {values.map((item) => (
          <div key={item.value}>
            <span>{item.value}</span>
            <strong>{formatPerformanceMetric(item.metric.p75, metric)}</strong>
            <small>{item.metric.samples} 样本</small>
            {!item.metric.sufficient ? <Badge variant="outline">数据不足</Badge> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
