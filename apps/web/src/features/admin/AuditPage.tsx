import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, ShieldCheckIcon } from "lucide-react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { instanceAuditQueryOptions } from "@/lib/api/admin";
import { AdminPageLayout } from "./AdminPageLayout";

export function AuditPage() {
  const audit = useQuery(instanceAuditQueryOptions());
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return audit.data?.entries ?? [];
    return (audit.data?.entries ?? []).filter((entry) =>
      [entry.actorEmail, entry.action, entry.resourcePath, entry.requestId].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [audit.data, query]);

  return (
    <AdminPageLayout
      title="Instance 审计日志"
      description="追踪全局配置和危险操作。密码、Token 与 Secret 永不写入审计摘要。"
    >
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" />
            最近 100 条操作
          </CardTitle>
          <CardDescription>按操作人、资源路径或 Request ID 搜索。</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="relative mb-4 max-w-md">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索审计日志"
              aria-label="搜索审计日志"
            />
          </div>
          {audit.isLoading ? <AsyncLoading /> : null}
          {audit.error ? (
            <AsyncError
              error={audit.error}
              title="无法读取审计日志"
              remediation="确认实例管理员权限与 PostgreSQL 状态。"
              onRetry={() => void audit.refetch()}
            />
          ) : null}
          {audit.data ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>操作人</TableHead>
                    <TableHead>操作</TableHead>
                    <TableHead>资源</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>Request ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(entry.createdAt).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell>{entry.actorEmail || "系统"}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                      <TableCell
                        className="max-w-72 truncate font-mono text-xs"
                        title={entry.resourcePath}
                      >
                        {entry.resourcePath}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.configSource}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.requestId}
                      </TableCell>
                    </TableRow>
                  ))}
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        没有匹配的审计记录。
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AdminPageLayout>
  );
}
