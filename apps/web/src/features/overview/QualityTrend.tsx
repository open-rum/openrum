import { useEffect, useRef } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OverviewResponse } from "@/lib/api/client";

export function QualityTrend({ data }: { data: OverviewResponse }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let chart: ECharts | undefined;
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    let theme: MutationObserver | undefined;
    void import("echarts").then((echarts) => {
      if (cancelled || !container.current) return;
      chart = echarts.init(container.current, undefined, { renderer: "svg" });
      const update = () => chart?.setOption(chartOptions(data), true);
      update();
      resize = new ResizeObserver(() => chart?.resize());
      resize.observe(container.current);
      theme = new MutationObserver(update);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
      theme?.disconnect();
      chart?.dispose();
    };
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>访问量与稳定性</CardTitle>
        <CardDescription>
          PV、近似 UV 与错误率使用相同 UTC 时间桶；错误率使用右侧坐标轴。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          ref={container}
          className="h-72 w-full"
          role="img"
          aria-label="PV、UV 和错误率时间趋势"
        />
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">
            查看趋势表格数据
          </summary>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>PV</TableHead>
                <TableHead>UV</TableHead>
                <TableHead>错误率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.series.map((point) => (
                <TableRow key={point.bucket}>
                  <TableCell>
                    <time dateTime={point.bucket}>{formatBucket(point.bucket)}</time>
                  </TableCell>
                  <TableCell>{point.pageViews.value.toLocaleString()}</TableCell>
                  <TableCell>{point.uniqueUsers.value.toLocaleString()}</TableCell>
                  <TableCell>
                    {point.errorRate.value === null
                      ? "—"
                      : `${(point.errorRate.value * 100).toFixed(2)}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      </CardContent>
    </Card>
  );
}

function chartOptions(data: OverviewResponse): EChartsOption {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  const labels = data.series.map((point) => formatBucket(point.bucket));
  return {
    animationDuration: 180,
    aria: {
      enabled: true,
      description: "质量趋势图。包含页面浏览量、近似独立用户数和错误率；下方提供相同数据的表格。",
    },
    color: [color("--ds-brand"), color("--ds-info"), color("--ds-danger")],
    grid: { left: 48, right: 52, top: 24, bottom: 36 },
    legend: { top: 0, textStyle: { color: color("--ds-text-muted") } },
    tooltip: { trigger: "axis", confine: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLine: { lineStyle: { color: color("--ds-border") } },
      axisLabel: { color: color("--ds-text-muted"), hideOverlap: true },
    },
    yAxis: [
      {
        type: "value",
        splitLine: { lineStyle: { color: color("--ds-border-soft") } },
        axisLabel: { color: color("--ds-text-muted") },
      },
      {
        type: "value",
        axisLabel: { formatter: "{value}%", color: color("--ds-text-muted") },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "PV",
        type: "line",
        showSymbol: false,
        sampling: "lttb",
        data: data.series.map((point) => point.pageViews.value),
      },
      {
        name: "UV",
        type: "line",
        showSymbol: false,
        sampling: "lttb",
        data: data.series.map((point) => point.uniqueUsers.value),
      },
      {
        name: "错误率",
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: false,
        data: data.series.map((point) =>
          point.errorRate.value === null ? null : point.errorRate.value * 100,
        ),
      },
    ],
  };
}

function formatBucket(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}
