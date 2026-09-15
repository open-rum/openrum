import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OverviewFilters } from "@/lib/filters/schema";
import { adaptList, adaptPlot, adaptStat, formatDetailedMetric } from "./adapters";
import { describeComparison } from "./comparison";
import { metricLabel, widgetDescription, type Widget } from "./model";
import { PlotRenderer, ListRenderer } from "./ModuleRenderers";
import { effectiveOverviewFilters, type DashboardData } from "./queries";

function dateLabel(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN") : "—";
}

export function ModuleDetailContent({
  widget,
  data,
  filters,
}: {
  widget: Widget;
  data: DashboardData;
  filters: OverviewFilters;
}) {
  const scalar = widget.type === "stat" ? adaptStat(widget, data) : undefined;
  const delta = scalar ? describeComparison(scalar, widget) : null;
  const effective =
    widget.data.source === "overview" ? effectiveOverviewFilters(widget, filters) : undefined;
  const freshness = data.result.freshness;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <dl className="dashboard-detail-meta">
        <div>
          <dt>时间范围</dt>
          <dd>
            {dateLabel(filters.from)} — {dateLabel(filters.to)}
          </dd>
        </div>
        <div>
          <dt>环境</dt>
          <dd>{filters.environment || "全部环境"}</dd>
        </div>
        <div>
          <dt>统计口径</dt>
          <dd>
            {widgetDescription(widget)}
            {scalar ? ` · ${scalar.detail}` : ""}
          </dd>
        </div>
        {effective?.route ? (
          <div>
            <dt>路由</dt>
            <dd>{effective.route}</dd>
          </div>
        ) : null}
        {effective?.release ? (
          <div>
            <dt>版本</dt>
            <dd>{effective.release}</dd>
          </div>
        ) : null}
        {freshness ? (
          <div>
            <dt>最近接收</dt>
            <dd>
              {dateLabel(freshness.latestReceivedAt)}{" "}
              <Badge variant="outline">{freshness.stale ? "数据延迟" : "数据正常"}</Badge>
            </dd>
          </div>
        ) : null}
      </dl>
      {scalar ? (
        <section aria-label="周期对比" className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">周期对比</h3>
          {data.source === "overview" ? (
            <p className="text-xs text-muted-foreground">
              上一周期：{dateLabel(data.result.comparison.from)} —{" "}
              {dateLabel(data.result.comparison.to)}
            </p>
          ) : null}
          <Table aria-label={`${widget.title} 周期对比表`}>
            <TableHeader>
              <TableRow>
                <TableHead>指标</TableHead>
                <TableHead>当前周期</TableHead>
                <TableHead>上一周期</TableHead>
                <TableHead>变化</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{metricLabel(widget.data, widget.data.metrics[0])}</TableCell>
                <TableCell>{formatDetailedMetric(scalar.value, scalar.unit)}</TableCell>
                <TableCell>
                  {formatDetailedMetric(scalar.comparison?.previous ?? null, scalar.unit)}
                </TableCell>
                <TableCell>{delta?.label ?? "无对比"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {scalar.insufficient ? (
            <p className="text-xs text-muted-foreground">
              样本不足，当前数值仅供参考，不判定趋势改善或恶化。
            </p>
          ) : null}
          {scalar.comparison?.unit === "points" ? (
            <p className="text-xs text-muted-foreground">
              pp 表示百分点，变化为当前比率减去上一周期比率。
            </p>
          ) : null}
          {!scalar.comparison || scalar.comparison.change === null ? (
            <p className="text-xs text-muted-foreground">
              未提供可比变化值；可能没有上一周期样本或相对变化的基数为零。
            </p>
          ) : null}
        </section>
      ) : null}
      {widget.type === "top-issues" || widget.type === "slow-apis" ? (
        <ListRenderer widget={widget} data={adaptList(widget, data, filters)} />
      ) : (
        <section aria-label="趋势与数据表" className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">
            {widget.type === "breakdown" ? "分布与数据表" : "趋势与数据表"}
          </h3>
          <PlotRenderer
            widget={scalar ? { ...widget, view: "line" } : widget}
            data={adaptPlot(widget, data)}
            detailed
          />
        </section>
      )}
    </div>
  );
}
