import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeTone, formatChange } from "@/lib/charts/comparison";
import { categoryColor } from "@/lib/charts/palette";
import { Sparkline } from "@/lib/charts/Sparkline";
import type { OverviewFilters } from "@/lib/filters/schema";
import { formatDetailedMetric, formatMetric, type Unit } from "./adapters";
import type { MatrixData, RankedData } from "./adaptCatalog";
import { donutShare } from "@/components/charts/donutData";
import { drilldownURL } from "./drilldown";
import { catalogDimensionLabels } from "./model";
import { toneBadge } from "./comparison";

function ChangeBadge({
  change,
  ratio,
  direction,
}: {
  change: number | null;
  ratio: boolean;
  direction: "up" | "down" | "neutral";
}) {
  const label = formatChange(change, ratio);
  const tone = changeTone(change, ratio, direction);
  // The arrow and the signed text carry the direction, so colour is never the only signal.
  return (
    <span
      className={cn("dashboard-comparison badge badge-sm badge-soft", toneBadge[tone])}
      aria-label={change === null ? "无对比" : `较上一周期 ${label}`}
    >
      {change !== null && change > 0 ? (
        <TrendingUpIcon className="size-3" aria-hidden="true" />
      ) : null}
      {change !== null && change < 0 ? (
        <TrendingDownIcon className="size-3" aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}

function EmptyTable() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-center">
      <p className="font-medium">当前范围暂无数据</p>
      <p className="text-sm text-base-content/70">可以调整时间、环境或模块筛选；配置会保留。</p>
    </div>
  );
}

/** One metric ranked by group: value, change against the previous period and a trend. */
export function RankedTable({
  data,
  title,
  filters,
  detailed = false,
}: {
  data: RankedData;
  title: string;
  filters: OverviewFilters;
  detailed?: boolean;
}) {
  if (!data.rows.length) return <EmptyTable />;
  const dimensionName =
    catalogDimensionLabels[data.dimension] ?? data.dimension.replace(/^property:/, "");
  const rows = detailed ? data.rows : data.rows.slice(0, 10);
  const total = data.total ?? 0;
  return (
    <div className="dashboard-catalog-table flex min-w-0 flex-col gap-2" data-ranked-table>
      <div
        className="max-h-80 overflow-auto"
        tabIndex={0}
        role="region"
        aria-label={`${title} 排行滚动区域`}
      >
        <table className="table table-sm" aria-label={`${title} 排行`}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-10">#</th>
              <th>{dimensionName}</th>
              <th className="text-right">{data.meta.label}</th>
              <th className="text-right">变化</th>
              <th className="dashboard-catalog-trend w-28">趋势</th>
              {data.shareable ? <th className="dashboard-catalog-share text-right">占比</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const href = drilldownURL(data.meta.id, data.dimension, row.value, filters);
              return (
                <tr key={row.value} data-insufficient={row.sufficient ? undefined : true}>
                  <td className="text-base-content/70 tabular-nums">{index + 1}</td>
                  <td className="max-w-56">
                    {href ? (
                      <a
                        href={href}
                        className="block truncate underline-offset-4 hover:underline"
                        title={row.label}
                      >
                        {row.label}
                      </a>
                    ) : (
                      <span className="block truncate" title={row.label}>
                        {row.label}
                      </span>
                    )}
                  </td>
                  <td className="text-right font-medium tabular-nums">
                    {formatMetric(row.current, data.unit)}
                    {row.sufficient ? null : (
                      <span
                        className="ml-1 text-xs text-base-content/70"
                        title="样本不足，仅供参考"
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <ChangeBadge
                      change={row.change}
                      ratio={data.ratio}
                      direction={data.meta.direction}
                    />
                  </td>
                  <td className="dashboard-catalog-trend">
                    <Sparkline values={row.sparkline} color={categoryColor(0)} />
                  </td>
                  {data.shareable ? (
                    <td className="dashboard-catalog-share text-right text-base-content/70 tabular-nums">
                      {total > 0 && row.current !== null ? donutShare(row.current / total) : "—"}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-base-content/70">
        {data.note}
        {data.limitReached ? ` · 仅展示前 ${data.topN} 个分组` : ""}
        {data.rows.some((row) => !row.sufficient) ? " · * 样本不足，仅供参考" : ""}
      </p>
    </div>
  );
}

type SortState = { key: string; direction: "asc" | "desc" };

/** Several metrics per group, each column with its own unit, sortable by any column. */
export function MetricTable({
  data,
  title,
  detailed = false,
}: {
  data: MatrixData;
  title: string;
  detailed?: boolean;
}) {
  const [sort, setSort] = useState<SortState>({
    key: data.columns[0]?.key ?? "",
    direction: "desc",
  });
  if (!data.rows.length) return <EmptyTable />;
  const dimensionName =
    catalogDimensionLabels[data.dimension] ?? data.dimension.replace(/^property:/, "");
  const sorted = [...data.rows].sort((a, b) => {
    const left = a.cells[sort.key]?.value;
    const right = b.cells[sort.key]?.value;
    // Missing values sort last whichever way the column is ordered.
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return sort.direction === "desc" ? right - left : left - right;
  });
  const rows = detailed ? sorted : sorted.slice(0, 15);
  const toggle = (key: string) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    );
  return (
    <div className="dashboard-catalog-table flex min-w-0 flex-col gap-2" data-metric-table>
      <div
        className="max-h-80 overflow-auto"
        tabIndex={0}
        role="region"
        aria-label={`${title} 指标表滚动区域`}
      >
        <table className="table table-sm" aria-label={`${title} 指标表`}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="sticky left-0 z-10 bg-card">{dimensionName}</th>
              {data.columns.map((column) => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    className="text-right"
                    aria-sort={
                      active ? (sort.direction === "desc" ? "descending" : "ascending") : "none"
                    }
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
                      onClick={() => toggle(column.key)}
                    >
                      {column.meta.label}
                      <span className="text-base-content/70">{unitHint(column.unit)}</span>
                      {active ? (
                        sort.direction === "desc" ? (
                          <ArrowDownIcon className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowUpIcon className="size-3" aria-hidden="true" />
                        )
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.value}>
                <td className="sticky left-0 max-w-56 bg-card">
                  <span className="block truncate" title={row.label}>
                    {row.label}
                  </span>
                </td>
                {data.columns.map((column) => {
                  const cell = row.cells[column.key];
                  return (
                    <td key={column.key} className="text-right tabular-nums">
                      {formatDetailedMetric(cell?.value ?? null, column.unit)}
                      {cell && !cell.sufficient ? (
                        <span
                          className="ml-1 text-xs text-base-content/70"
                          title="样本不足，仅供参考"
                        >
                          *
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-base-content/70">
        {data.note}
        {data.limitReached ? ` · 仅展示前 ${data.topN} 个分组` : ""}
      </p>
    </div>
  );
}

function unitHint(unit: Unit) {
  return unit === "percent" ? "%" : unit === "ms" ? "ms" : "";
}
