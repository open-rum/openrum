import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPerformanceMetric } from "@/lib/api/performance";
import type { OverviewResponse } from "@/lib/api/client";
import { bucketFormatter, formatRate } from "./format";

/**
 * The non-visual equivalent of every trend panel above it. It is one table
 * rather than one per chart because the panels all plot the same buckets, and
 * reading them against each other is the point.
 */
export function TrendTable({ series }: { series: OverviewResponse["series"] }) {
  if (series.length === 0) return null;
  return (
    <details className="border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium text-primary">
        查看趋势表格数据
      </summary>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间 (UTC)</TableHead>
              <TableHead>PV</TableHead>
              <TableHead>UV</TableHead>
              <TableHead>错误率</TableHead>
              <TableHead>API 失败率</TableHead>
              <TableHead>LCP P75</TableHead>
              <TableHead>INP P75</TableHead>
              <TableHead>CLS P75</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.map((point) => (
              <TableRow key={point.bucket}>
                <TableCell>
                  <time dateTime={point.bucket}>{bucketFormatter(point.bucket)}</time>
                </TableCell>
                <TableCell>{point.pageViews.value.toLocaleString()}</TableCell>
                <TableCell>{point.uniqueUsers.value.toLocaleString()}</TableCell>
                <TableCell>{formatRate(point.errorRate.value)}</TableCell>
                <TableCell>{formatRate(point.apiFailureRate.value)}</TableCell>
                <TableCell>{formatPerformanceMetric(point.lcp.p75, "LCP")}</TableCell>
                <TableCell>{formatPerformanceMetric(point.inp.p75, "INP")}</TableCell>
                <TableCell>{formatPerformanceMetric(point.cls.p75, "CLS")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
