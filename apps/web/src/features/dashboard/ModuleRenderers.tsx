import { PlotChart, PlotTable } from "@/components/charts/PlotChart";
import { TopIssuesContent } from "@/features/overview/TopIssues";
import { formatMetric, type AdaptedData } from "./adapters";
import { MetricTable, RankedTable } from "./CatalogTables";
import type { Widget } from "./model";
import { ModuleComparison } from "./ModuleComparison";
import { StatTrend } from "./StatTrend";

export { PlotTable };

export type ModuleRenderProps = {
  widget: Widget;
  data: AdaptedData;
  detailed?: boolean;
  showTable?: boolean;
  showNotes?: boolean;
  showInterval?: boolean;
};

export function StatRenderer({ widget, data }: ModuleRenderProps) {
  if (data.kind !== "scalar") return null;
  const summary = (
    <div className="relative z-10 flex min-w-0 flex-col gap-3">
      <strong className="text-3xl font-semibold tracking-tight tabular-nums">
        {formatMetric(data.value, data.unit)}
      </strong>
    </div>
  );
  const comparison = <ModuleComparison widget={widget} data={data} variant="corner" />;
  const appearance = widget.statAppearance ?? "plain";
  if (appearance === "plain")
    return (
      <>
        {summary}
        {comparison}
      </>
    );
  return (
    <>
      <div
        data-stat-appearance={appearance}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-3"
      >
        {summary}
        <StatTrend data={data.trend} appearance={appearance} />
      </div>
      {comparison}
    </>
  );
}

export function PlotRenderer({
  widget,
  data,
  detailed = false,
  showTable = detailed,
  showNotes = detailed,
  showInterval = false,
}: ModuleRenderProps) {
  if (data.kind !== "series" && data.kind !== "categories") return null;
  return (
    <PlotChart
      data={data}
      // "number" is the stat card's view and never reaches a plot.
      view={widget.view === "number" ? "line" : widget.view}
      title={widget.title}
      detailed={detailed}
      showTable={showTable}
      showNotes={showNotes}
      showInterval={showInterval}
    />
  );
}

export function TableRenderer({ widget, data, detailed = false }: ModuleRenderProps) {
  if (data.kind === "ranked")
    return (
      <RankedTable data={data} title={widget.title} filters={data.filters} detailed={detailed} />
    );
  if (data.kind === "matrix")
    return <MetricTable data={data} title={widget.title} detailed={detailed} />;
  return null;
}

export function ListRenderer({ data }: ModuleRenderProps) {
  if (data.kind === "issues")
    return <TopIssuesContent issues={data.issues} filters={data.filters} />;
  return null;
}
