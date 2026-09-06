import { BugIcon } from "lucide-react";
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
import type { OverviewFilters } from "@/lib/filters/schema";
import { serializeOverviewFilters } from "@/lib/filters/schema";

export function TopIssues({
  issues,
  filters,
}: {
  issues: OverviewResponse["topIssues"];
  filters: OverviewFilters;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 问题</CardTitle>
        <CardDescription>按受影响用户排序，保留当前时间与环境筛选。</CardDescription>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <Empty className="min-h-48">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BugIcon />
              </EmptyMedia>
              <EmptyTitle>当前没有可排名的问题</EmptyTitle>
              <EmptyDescription>
                错误指纹聚合将在问题模型启用后显示；原始错误仍会进入事件存储。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>问题</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>事件</TableHead>
                <TableHead>最近发生</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue, index) => (
                <TableRow key={issue.fingerprint}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <a
                      className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={issueURL(issue.fingerprint, filters)}
                    >
                      {issue.title}
                    </a>
                    <code className="mt-1 block max-w-72 truncate text-xs text-muted-foreground">
                      {issue.fingerprint}
                    </code>
                  </TableCell>
                  <TableCell>{issue.users.toLocaleString()}</TableCell>
                  <TableCell>{issue.events.toLocaleString()}</TableCell>
                  <TableCell>
                    {issue.lastSeenAt ? new Date(issue.lastSeenAt).toLocaleString("zh-CN") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function issueURL(fingerprint: string, filters: OverviewFilters) {
  const parameters = serializeOverviewFilters(filters);
  return `/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(fingerprint)}?${parameters.toString()}`;
}
