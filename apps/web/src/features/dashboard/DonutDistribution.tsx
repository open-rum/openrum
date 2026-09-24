import { useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { formatDetailedMetric, formatMetric, type PlotData } from "./adapters";
import { donutData, donutShare } from "./donutData";

export function DonutDistribution({ data, title }: { data: PlotData; title: string }) {
  const animate = useChartMotion();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { items, total } = donutData(data);
  const active = items.find((item) => item.id === activeId);
  if (!items.length)
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyTitle>当前范围暂无分布数据</EmptyTitle>
          <EmptyDescription>可以调整时间、环境或事件筛选。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const config = Object.fromEntries(
    items.map((item) => [item.id, { label: item.label, color: item.fill }]),
  );
  return (
    <div className="dashboard-donut" data-donut-distribution>
      <div className="dashboard-donut-layout">
        <div className="dashboard-donut-visual">
          <ChartContainer
            config={config}
            className="aspect-square size-full"
            initialDimension={{ width: 208, height: 208 }}
            aria-label={`${title} 圆环分布`}
          >
            <PieChart accessibilityLayer>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    nameKey="id"
                    formatter={(value, _name, entry) => {
                      const item = entry.payload as (typeof items)[number];
                      return (
                        <div className="flex items-center gap-4">
                          <span>{item.label}</span>
                          <strong>
                            {formatDetailedMetric(Number(value), "count")} ·{" "}
                            {donutShare(item.share)}
                          </strong>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Pie
                data={items}
                dataKey="value"
                nameKey="id"
                innerRadius="66%"
                outerRadius="90%"
                startAngle={90}
                endAngle={-270}
                paddingAngle={items.length > 1 ? 2 : 0}
                cornerRadius={4}
                strokeWidth={0}
                isAnimationActive={animate}
                animationDuration={450}
                onMouseEnter={(_, index) => setActiveId(items[index]?.id ?? null)}
                onMouseLeave={() => setActiveId(null)}
              >
                {items.map((item) => (
                  <Cell
                    key={item.id}
                    fill={item.fill}
                    fillOpacity={!active || active.id === item.id ? 1 : 0.3}
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="dashboard-donut-center" aria-hidden="true">
            <strong>{active ? donutShare(active.share) : formatMetric(total, "count")}</strong>
            <span title={active?.label}>{active?.label ?? "分组合计"}</span>
          </div>
        </div>
        <Table className="dashboard-donut-list" aria-label={`${title} 分布列表`}>
          <TableHeader>
            <TableRow>
              <TableHead>分类</TableHead>
              <TableHead>数量</TableHead>
              <TableHead>占比</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                tabIndex={0}
                data-highlighted={active?.id === item.id || undefined}
                onMouseEnter={() => setActiveId(item.id)}
                onMouseLeave={() => setActiveId(null)}
                onFocus={() => setActiveId(item.id)}
                onBlur={() => setActiveId(null)}
              >
                <TableCell>
                  <span className="dashboard-donut-name">
                    <i style={{ background: item.fill }} aria-hidden="true" />
                    <span title={item.label}>{item.label}</span>
                  </span>
                </TableCell>
                <TableCell>{formatDetailedMetric(item.value, "count")}</TableCell>
                <TableCell>{donutShare(item.share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        占比按已返回分组合计计算
        {data.distribution?.nonAdditive
          ? "；用户 / 会话可能跨分组重复，不代表去重总数。"
          : " · 事件次数按采样率估算。"}
        {data.distribution?.limitReached
          ? ` 已达到 ${data.distribution.rowLimit} 组查询上限，分布可能不完整。`
          : ""}
      </p>
    </div>
  );
}
