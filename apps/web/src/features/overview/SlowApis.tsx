import { ActivityIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OverviewResponse } from "@/lib/api/client";
import { serializeOverviewFilters, type OverviewFilters } from "@/lib/filters/schema";

export function SlowApis({
  apis,
  filters,
}: {
  apis: OverviewResponse["slowApis"];
  filters: OverviewFilters;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>慢 API</CardTitle>
        <CardDescription>
          按 P95 耗时排序；URL 已在 SDK 和服务端去除 query 与敏感内容。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {apis.length === 0 ? (
          <Empty className="min-h-48">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon />
              </EmptyMedia>
              <EmptyTitle>当前没有 API 请求样本</EmptyTitle>
              <EmptyDescription>
                确认 fetch/XHR instrumentation 已启用，或扩大时间范围。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>接口</TableHead>
                <TableHead>请求</TableHead>
                <TableHead>失败率</TableHead>
                <TableHead>P95</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apis.map((api) => (
                <TableRow key={`${api.method}:${api.url}`}>
                  <TableCell>
                    <a
                      className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={apiURL(api, filters)}
                    >
                      <span className="mr-2 text-xs text-muted-foreground">{api.method}</span>
                      {api.url}
                    </a>
                  </TableCell>
                  <TableCell>{api.requests.toLocaleString()}</TableCell>
                  <TableCell>
                    {api.failureRate === null ? "—" : `${(api.failureRate * 100).toFixed(2)}%`}
                  </TableCell>
                  <TableCell>{formatDuration(api.durationP95)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function apiURL(api: OverviewResponse["slowApis"][number], filters: OverviewFilters) {
  const parameters = serializeOverviewFilters(filters);
  parameters.set("method", api.method);
  parameters.set("url", api.url);
  return `/apis?${parameters.toString()}`;
}
function formatDuration(value: number | null) {
  return value === null
    ? "—"
    : value >= 1000
      ? `${(value / 1000).toFixed(2)}s`
      : `${Math.round(value)}ms`;
}
