import {
  performanceRating,
  ratingBadge,
  ratingLabel,
  type PerformanceRating,
} from "@/features/performance/score";
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
  const metricKey = widget.data.metrics[0];
  // The shared health thresholds describe P75; other quantiles remain ungraded.
  const metric =
    metricKey && !/P(?:50|95)$/.test(metricKey)
      ? metricKey
          .replace(/^vitals\./, "")
          .replace(/P75$/, "")
          .toUpperCase()
      : undefined;
  const rating: PerformanceRating | undefined =
    metric && ["LCP", "INP", "CLS", "FCP", "TTFB"].includes(metric)
      ? performanceRating(data.value, metric as "LCP" | "INP" | "CLS" | "FCP" | "TTFB")
      : undefined;
  const formatted = formatMetric(data.value, data.unit);
  const suffix =
    data.value !== null && (data.unit === "ms" || data.unit === "percent")
      ? (formatted.match(/(ms|s|%)$/)?.[0] ?? "")
      : "";
  const summary = (
    <div className="relative z-10 flex min-h-20 min-w-0 flex-col items-start gap-2">
      <strong className="text-3xl font-semibold tracking-tight tabular-nums">
        {suffix ? formatted.slice(0, -suffix.length) : formatted}
        {suffix ? (
          <span className="ml-1 text-sm font-medium tracking-normal text-base-content/70">
            {suffix}
          </span>
        ) : null}
      </strong>
      {rating ? (
        <span className={`badge badge-sm badge-soft ${ratingBadge[rating]}`}>
          {ratingLabel(rating)}
        </span>
      ) : null}
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
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-start gap-3"
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
