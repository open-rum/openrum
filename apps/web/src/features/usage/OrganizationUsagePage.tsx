import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { RefreshCwIcon, ChartColumnIcon, FolderIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ConsolePage, ConsolePageHeader, ConsoleFilterBar } from "@/components/layout/ConsolePage";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncError } from "@/components/ui/AsyncState";
import { EmptyState } from "@/components/ui/EmptyState";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { usageRange } from "@/lib/api/usage";
import {
  formatUsageBytes,
  loadOrganizationUsage,
  projectUsageLink,
  readUsageRange,
  summarizeUsage,
  usageTypes,
} from "./organizationUsage";

const chartConfig = {
  accepted: { label: "已接收", color: "var(--ds-chart-1)" },
  sampled: { label: "采样丢弃", color: "var(--ds-chart-2)" },
  rejected: { label: "已拒绝", color: "var(--ds-warning)" },
  failed: { label: "处理失败", color: "var(--ds-danger)" },
};
const number = new Intl.NumberFormat("zh-CN");
const date = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function OrganizationUsagePage() {
  const navigate = useNavigate();
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const search = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const [fallback] = useState(() => usageRange(7));
  const range = readUsageRange(search, fallback);
  const [projectSearch, setProjectSearch] = useState("");
  const animate = useChartMotion();
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const orgs = organizations.data?.organizations ?? [];
  const orgId = orgs.find((org) => org.id === search.get("organization"))?.id ?? orgs[0]?.id;
  const projects = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => listProjects(orgId!),
    enabled: Boolean(orgId),
  });
  const items = projects.data?.projects ?? [];
  const usage = useQuery({
    queryKey: [
      "organization-usage",
      orgId,
      items.map((item) => item.id),
      range.from.toISOString(),
      range.to.toISOString(),
      range.eventType,
    ],
    queryFn: ({ signal }) => loadOrganizationUsage(items, range, signal),
    enabled: Boolean(orgId) && projects.isSuccess,
    staleTime: 30000,
  });
  const summary = summarizeUsage(usage.data ?? [], range);
  const rows = [...(usage.data ?? [])]
    .filter(({ project }) =>
      `${project.name} ${project.slug}`.toLowerCase().includes(projectSearch.toLowerCase()),
    )
    .sort((a, b) => (b.usage?.totals.accepted ?? -1) - (a.usage?.totals.accepted ?? -1));
  const hasData = (usage.data?.length ?? 0) > summary.unavailable;
  const update = (patch: Record<string, string>) => {
    const next = Object.fromEntries(search);
    Object.assign(next, { from: range.from.toISOString(), to: range.to.toISOString() }, patch);
    void navigate({ to: "/usage", search: next });
  };
  const duration = (range.to.getTime() - range.from.getTime()) / 86400000;

  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="用量统计"
        description="从组织视角查看各项目的数据接收与处理情况，覆盖全部环境。"
        actions={
          <Button
            variant="outline"
            disabled={usage.isFetching}
            onClick={() => void usage.refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
        }
      />
      <ConsoleFilterBar
        primary={
          <>
            <Select value={orgId ?? ""} onValueChange={(organization) => update({ organization })}>
              <SelectTrigger aria-label="组织" className="min-w-40">
                <SelectValue placeholder="选择组织" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={range.eventType ?? "all"}
              onValueChange={(eventType) => update({ eventType })}
            >
              <SelectTrigger aria-label="事件类型" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {usageTypes.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <ToggleGroup
              type="single"
              variant="selection"
              aria-label="用量时间范围"
              value={String(duration)}
              className="flex-wrap"
              onValueChange={(value) => {
                if (value) {
                  const next = usageRange(Number(value));
                  update({ from: next.from.toISOString(), to: next.to.toISOString() });
                }
              }}
            >
              {[1, 7, 30, 90].map((days) => (
                <ToggleGroupItem key={days} value={String(days)}>
                  {days === 1 ? "最近 24 小时" : `最近 ${days} 天`}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        }
      />
      <p className="text-xs text-muted-foreground">
        {date.format(range.from)} — {date.format(range.to)} · 本地时区；按 UTC 小时 /
        天聚合。传输流量不是磁盘占用，接收量不是配额使用率。
      </p>
      {organizations.error || projects.error ? (
        <AsyncError
          title="组织项目加载失败"
          remediation="请刷新重试，或检查当前组织权限。"
          error={organizations.error ?? projects.error}
          onRetry={() => {
            void organizations.refetch();
            void projects.refetch();
          }}
        />
      ) : null}
      {organizations.isLoading || (orgId && projects.isLoading) || usage.isLoading ? (
        <Skeleton className="h-64" aria-label="正在加载组织用量" />
      ) : null}
      {usage.error ? (
        <AsyncError
          title="用量加载失败"
          remediation="请缩短时间范围或重新加载。"
          error={usage.error}
          onRetry={() => void usage.refetch()}
        />
      ) : null}
      {usage.data && summary.unavailable > 0 ? (
        <Alert>
          <AlertTitle>{hasData ? "部分项目用量不可用" : "所有项目用量暂不可用"}</AlertTitle>
          <AlertDescription>
            {summary.unavailable}{" "}
            个项目查询失败。汇总仅包含成功加载的项目，占比暂不展示；请刷新重试。
          </AlertDescription>
        </Alert>
      ) : null}
      {usage.data && items.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="还没有项目"
          description="创建并接入项目后，即可在此比较用量。"
        />
      ) : null}
      {organizations.isSuccess && !orgs.length ? (
        <EmptyState
          icon={FolderIcon}
          title="暂无可访问的组织"
          description="加入组织并接入项目后，即可查看用量统计。"
        />
      ) : null}
      {hasData ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="组织用量摘要">
            {[
              ["已接收", number.format(summary.totals.accepted)],
              ["采样丢弃", number.format(summary.totals.sampled)],
              ["已拒绝", number.format(summary.totals.rejected)],
              ["处理失败", number.format(summary.totals.failed)],
              ["传输流量", formatUsageBytes(summary.totals.bytes)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </section>
          <Card>
            <CardHeader>
              <CardTitle>用量趋势</CardTitle>
              <CardDescription>
                按处理结果分组；采样丢弃仅含已记录的数据，未上报的数据不计入。接收与后续处理失败可能涉及同一事件，不应相加作为独立事件总量。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary.truncated ? (
                <Alert>
                  <AlertTitle>趋势明细不完整</AlertTitle>
                  <AlertDescription>
                    查询已达到明细上限，请缩短时间范围或筛选事件类型。上方摘要与表格仍使用完整汇总，暂不绘制可能误导的趋势。
                  </AlertDescription>
                </Alert>
              ) : summary.series.length ? (
                <ChartContainer
                  config={chartConfig}
                  className="h-64 w-full aspect-auto"
                  initialDimension={{ width: 960, height: 256 }}
                  aria-label="事件处理结果趋势"
                >
                  <BarChart data={summary.series} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="bucket"
                      tickFormatter={(value) => date.format(new Date(value))}
                      minTickGap={50}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis width={58} tickLine={false} axisLine={false} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value) => date.format(new Date(value))}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    {Object.entries(chartConfig).map(([key]) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="outcomes"
                        fill={`var(--color-${key})`}
                        isAnimationActive={animate}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState
                  icon={ChartColumnIcon}
                  title="当前范围暂无用量记录"
                  description="可以扩大时间范围，或确认 SDK 已开始上报。"
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      {usage.data && items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>项目用量</CardTitle>
            <CardDescription>
              按已接收量从高到低排列。占比为当前组织可访问项目的接收量占比；搜索只过滤下方表格。
            </CardDescription>
            <Input
              aria-label="搜索项目"
              placeholder="搜索项目名称或标识"
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              className="mt-2 max-w-sm"
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "项目",
                    "已接收",
                    "接收量占比",
                    "采样丢弃",
                    "已拒绝",
                    "处理失败",
                    "传输流量",
                    "操作",
                  ].map((label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ project, usage: data }) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <a
                        className="font-medium hover:underline"
                        href={projectUsageLink(project.id, range)}
                      >
                        {project.name}
                      </a>
                      <p className="mt-1 text-xs text-muted-foreground">{project.slug}</p>
                    </TableCell>
                    {data ? (
                      <>
                        <TableCell>{number.format(data.totals.accepted)}</TableCell>
                        <TableCell>
                          {summary.unavailable || !summary.totals.accepted
                            ? "—"
                            : `${((data.totals.accepted / summary.totals.accepted) * 100).toFixed(1)}%`}
                        </TableCell>
                        <TableCell>{number.format(data.totals.sampled)}</TableCell>
                        <TableCell>{number.format(data.totals.rejected)}</TableCell>
                        <TableCell>{number.format(data.totals.failed)}</TableCell>
                        <TableCell>{formatUsageBytes(data.totals.bytes)}</TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={6}>查询失败，未计入汇总</TableCell>
                    )}
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={projectUsageLink(project.id, range)}>查看明细</a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={8}>没有匹配的项目</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </ConsolePage>
  );
}
