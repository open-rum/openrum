import { ChartNoAxesCombinedIcon, Table2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OverviewFilters } from "@/lib/filters/schema";
import {
  adaptList,
  adaptPlot,
  adaptStat,
  adaptTable,
  formatDetailedMetric,
  type ScalarData,
} from "./adapters";
import { intervalLabel } from "./chartDensity";
import { describeComparison } from "./comparison";
import { eventKindLabels, metricLabel, widgetDescription, type Widget } from "./model";
import { ModuleComparison } from "./ModuleComparison";
import { PlotRenderer, ListRenderer, PlotTable, TableRenderer } from "./ModuleRenderers";
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
  const list = widget.type === "top-issues";
  // Tables open as the full table — every returned row — not as a chart of one column.
  const table = widget.type === "ranked-table" || widget.type === "metric-table";
  const plot = list || table ? undefined : adaptPlot(widget, data);
  const effective =
    widget.data.source === "overview" ? effectiveOverviewFilters(widget, filters) : undefined;
  const freshness = data.result.freshness;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const chartWidget: Widget = scalar ? { ...widget, view: "area" } : widget;

  return (
    <div className="dashboard-detail-layout">
      <div className="dashboard-detail-main" role="region" aria-label="图表与数据" tabIndex={0}>
        {scalar ? <ScalarSummary widget={widget} scalar={scalar} data={data} /> : null}
        {list ? (
          <section aria-label="详细列表" className="min-w-0">
            <ListRenderer widget={widget} data={adaptList(widget, data, filters)} />
          </section>
        ) : table ? (
          <section aria-label="详细表格" className="min-w-0">
            <TableRenderer widget={widget} data={adaptTable(widget, data, filters)} detailed />
          </section>
        ) : plot ? (
          <Tabs defaultValue={widget.view === "table" ? "table" : "chart"} className="gap-5">
            <div className="dashboard-detail-chart-toolbar">
              <TabsList aria-label="详情展示方式">
                {widget.view !== "table" ? (
                  <TabsTrigger value="chart" className="px-3">
                    <ChartNoAxesCombinedIcon />
                    {plot.kind === "categories" ? "分布" : "趋势"}
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="table" className="px-3">
                  <Table2Icon />
                  数据表
                </TabsTrigger>
              </TabsList>
              <span className="text-xs text-muted-foreground">
                {plot.kind === "categories"
                  ? `已返回 ${plot.rows.length} 个分组`
                  : plot.intervalSeconds
                    ? `${intervalLabel(plot.intervalSeconds)} / 时间桶`
                    : "当前时间范围"}
              </span>
            </div>
            <TabsContent value="chart" className="dashboard-detail-visual">
              <PlotRenderer
                widget={chartWidget}
                data={plot}
                detailed
                showTable={false}
                showNotes={false}
                showInterval={false}
              />
            </TabsContent>
            <TabsContent value="table" className="dashboard-detail-table">
              <PlotTable
                data={plot}
                title={widget.title}
                countryLabels={plot.distribution?.dimension === "country"}
              />
              {plot.empty ? (
                <p className="mt-4 text-sm text-muted-foreground">当前范围暂无数据。</p>
              ) : null}
            </TabsContent>
          </Tabs>
        ) : null}
      </div>

      <aside className="dashboard-detail-sidebar" aria-label="统计说明" tabIndex={0}>
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">数据状态</h3>
            {freshness ? (
              <Badge
                variant="outline"
                className="dashboard-detail-freshness"
                data-stale={freshness.stale}
              >
                <span aria-hidden="true" />
                {freshness.stale ? "数据延迟" : "数据正常"}
              </Badge>
            ) : (
              <Badge variant="outline">状态未知</Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {freshness?.stale
              ? "最近未接收到新数据，当前图表可能尚未覆盖所选范围末尾。"
              : "与卡片使用同一份查询结果。"}
          </p>
          <dl className="dashboard-detail-meta">
            <div>
              <dt>最近接收</dt>
              <dd>{dateLabel(freshness?.latestReceivedAt)}</dd>
            </div>
          </dl>
        </section>
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-medium">查询范围</h3>
          <dl className="dashboard-detail-meta">
            <div>
              <dt>时间范围</dt>
              <dd className="flex flex-col gap-1 tabular-nums">
                <span>{dateLabel(filters.from)}</span>
                <span className="text-xs text-muted-foreground">至</span>
                <span>{dateLabel(filters.to)}</span>
                <span className="mt-1 text-xs text-muted-foreground">{timeZone}</span>
              </dd>
            </div>
            <div>
              <dt>环境</dt>
              <dd>{filters.environment || "全部环境"}</dd>
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
            {widget.data.source === "events" ? (
              <>
                <div>
                  <dt>事件类型</dt>
                  <dd>
                    {widget.data.eventKind
                      ? eventKindLabels[widget.data.eventKind]
                      : "全部行为事件"}
                  </dd>
                </div>
                {widget.data.eventName ? (
                  <div>
                    <dt>事件名称</dt>
                    <dd>{widget.data.eventName}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        </section>
        <section className="flex flex-col gap-3 text-xs leading-relaxed text-muted-foreground">
          <h3 className="text-sm font-medium text-foreground">统计口径</h3>
          <p>{scalar?.detail || widgetDescription(widget)}</p>
          {plot ? <p>{plot.note}</p> : null}
          {plot?.thresholds ? (
            <p>
              参考线：良好 ≤ {formatDetailedMetric(plot.thresholds.good, plot.series[0].unit)}；较差
              &gt; {formatDetailedMetric(plot.thresholds.poor, plot.series[0].unit)}。
            </p>
          ) : null}
          {plot?.kind === "series" ? <p>缺少样本的时间桶保留为空，不补零，不跨缺口连线。</p> : null}
          {plot?.distribution?.nonAdditive ? (
            <p>用户 / 会话可能跨分组重复，分组合计不是去重总量。</p>
          ) : null}
          {plot?.distribution?.limitReached ? (
            <p>已达到 {plot.distribution.rowLimit} 组查询上限，分布可能不完整。</p>
          ) : null}
          {scalar?.insufficient ? <p>样本不足，当前数值仅供参考，不判定趋势改善或恶化。</p> : null}
          {scalar?.comparison?.unit === "points" ? (
            <p>pp 表示百分点，变化为当前比率减去上一周期比率。</p>
          ) : null}
          {scalar && (!scalar.comparison || scalar.comparison.change === null) ? (
            <p>未提供可比变化值；可能没有上一周期样本或相对变化的基数为零。</p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

function ScalarSummary({
  widget,
  scalar,
  data,
}: {
  widget: Widget;
  scalar: ScalarData;
  data: DashboardData;
}) {
  const delta = describeComparison(scalar, widget);
  return (
    <section aria-label="周期对比" className="dashboard-detail-summary">
      <dl className="dashboard-detail-values">
        <div>
          <dt>{metricLabel(widget.data, widget.data.metrics[0])} · 当前周期</dt>
          <dd className="dashboard-detail-primary-value">
            {formatDetailedMetric(scalar.value, scalar.unit)}
          </dd>
        </div>
        <div>
          <dt>上一周期</dt>
          <dd>{formatDetailedMetric(scalar.comparison?.previous ?? null, scalar.unit)}</dd>
        </div>
        <div>
          <dt>周期变化</dt>
          <dd>{delta ? <ModuleComparison widget={widget} data={scalar} /> : "无对比"}</dd>
        </div>
      </dl>
      {data.source === "overview" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          上一周期：{dateLabel(data.result.comparison.from)} —{" "}
          {dateLabel(data.result.comparison.to)}
        </p>
      ) : null}
    </section>
  );
}
