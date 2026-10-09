import type { CatalogMetric, MetricCatalog, MetricsShape } from "@/lib/api/metricsQuery";
import { catalogDimensionLabels, type CatalogFilterKey, type Widget } from "./model";

type CatalogData = Extract<Widget["data"], { source: "catalog" }>;

export const catalogFilterLabels: Record<CatalogFilterKey, string> = {
  release: "版本",
  route: "页面路由",
  country: "国家/地区",
  browser: "浏览器",
  device: "设备类型",
  apiMethod: "请求方法",
  apiUrl: "API 地址",
  eventKind: "事件类型",
  eventName: "事件名称",
};

// The Console's copy of internal/catalog Validate, used so the editor can disable a bad
// combination instead of letting a save fail. It is held to the backend by one shared case
// matrix (internal/metadata/testdata/dashboard_widget_cases.json) that both sides run.

export type CatalogSpec = {
  metrics: string[];
  shape: MetricsShape;
  dimension?: string;
  measurement?: string;
  filters: Record<string, string | undefined>;
  compare: boolean;
  topN?: number;
  sort?: string;
  sparkline: boolean;
  stack?: "metrics" | "dimension";
  groups?: string[];
};

/** The question a module asks, mapped the same way catalog.ShapeForWidget maps it. */
export function catalogSpecForWidget(widget: Widget): CatalogSpec | undefined {
  if (widget.data.source !== "catalog") return undefined;
  const data = widget.data;
  const stacked = widget.view === "stacked-area" || widget.view === "stacked-bar";
  let shape: MetricsShape = "series";
  let stack: CatalogSpec["stack"];
  if (widget.type === "timeseries") {
    shape = data.dimension ? "seriesByDimension" : "series";
    if (stacked) stack = data.dimension ? "dimension" : "metrics";
  } else if (widget.type === "breakdown") shape = "breakdown";
  else if (widget.type === "ranked-table" || widget.type === "metric-table") shape = "table";
  return {
    metrics: data.metrics,
    shape,
    dimension: data.dimension,
    measurement: data.measurement,
    filters: data.filters,
    // Validate the query the Console will actually send.
    compare:
      widget.type === "stat" || widget.type === "ranked-table" || data.compare === "previous",
    topN: data.topN,
    sort: data.sort,
    sparkline: widget.type === "ranked-table" || Boolean(data.sparkline),
    stack,
    groups: data.groups,
  };
}

const measurementKey = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export function sharesAxis(metrics: CatalogMetric[]): string | null {
  let weighting: string | undefined;
  for (const metric of metrics) {
    if (metric.unit !== metrics[0].unit) return "同一图表的指标必须使用相同单位。";
    if (metric.unit !== "count" || metric.kind === "distinct") continue;
    if (weighting === undefined) weighting = metric.weighting;
    else if (metric.weighting !== weighting)
      return "按采样率还原的数量与未还原的数量不能共用坐标轴。";
  }
  return null;
}

/** Returns the first reason a spec cannot run, or null. Messages are shown in the editor. */
export function validateCatalogSpec(spec: CatalogSpec, catalog: MetricCatalog): string | null {
  const limit = catalog.limits.maxMetrics[spec.shape];
  if (!limit) return "不支持的展示形状。";
  if (!spec.metrics.length || spec.metrics.length > limit)
    return `此模块可选择 1 到 ${limit} 个指标。`;
  const byId = new Map(catalog.metrics.map((metric) => [metric.id, metric]));
  const resolved: CatalogMetric[] = [];
  for (const id of spec.metrics) {
    const metric = byId.get(id);
    if (!metric) return "指标不在当前目录中。";
    if (resolved.some((existing) => existing.id === id)) return "同一指标只能选择一次。";
    if (resolved.length && metric.source !== resolved[0].source)
      return "所选指标必须来自同一数据来源。";
    resolved.push(metric);
  }
  const first = resolved[0];

  if (first.requiresMeasurementKey) {
    if (!spec.measurement || !measurementKey.test(spec.measurement))
      return "业务指标需要填写数值名称。";
  } else if (spec.measurement) return "数值名称只适用于业务指标。";

  if (spec.shape !== "table") {
    const axis = sharesAxis(resolved);
    if (axis) return axis;
  }

  const needsDimension =
    spec.shape === "breakdown" || spec.shape === "seriesByDimension" || spec.shape === "table";
  if (!needsDimension && spec.dimension) return "此展示方式不需要分组维度。";
  if (needsDimension) {
    if (!spec.dimension) return "请选择一个分组维度。";
    if (spec.dimension.startsWith("property:")) {
      if (!first.propertyDimensions) return "自定义属性维度只适用于业务指标和用户行为。";
      if (!measurementKey.test(spec.dimension.slice("property:".length))) return "属性名称不合法。";
    } else if (resolved.some((metric) => !metric.dimensions.includes(spec.dimension!))) {
      return "所选指标不能按这个维度拆分。";
    }
  }

  for (const [key, value] of Object.entries(spec.filters)) {
    if (!value) continue;
    if (!first.filters.includes(key)) return "所选指标不支持这个筛选条件。";
    if (
      key === spec.dimension ||
      (spec.dimension === "api" && (key === "apiMethod" || key === "apiUrl"))
    )
      return "不能按正在拆分的维度筛选。";
  }

  if (spec.groups?.length) {
    const maximum =
      spec.shape === "seriesByDimension"
        ? catalog.limits.maxDimensionTopN
        : spec.shape === "breakdown"
          ? catalog.limits.maxBreakdownTopN
          : spec.shape === "table"
            ? catalog.limits.maxTableTopN
            : 0;
    if (!maximum) return "只有拆分或分组的模块可以指定分组。";
    if (spec.groups.length > maximum) return `最多指定 ${maximum} 个分组。`;
    if (spec.topN !== undefined && spec.topN !== spec.groups.length)
      return "指定分组后不再设置分组数量。";
    const values = spec.groups.map((value) => value.trim());
    if (values.some((value) => !value)) return "指定的分组不能为空。";
    if (spec.dimension === "country" && values.some((value) => !/^([A-Z]{2}|unknown)$/.test(value)))
      return "国家/地区需使用两位代码。";
    if (new Set(values).size !== values.length) return "同一分组只能指定一次。";
  }

  if (spec.stack === "metrics") {
    if (spec.shape !== "series" || resolved.length < 2) return "堆叠需要至少两个指标。";
    const group = first.compositionGroup;
    if (!group || resolved.some((metric) => metric.compositionGroup !== group))
      return "只有互不重叠、共同组成整体的指标才能堆叠。";
  } else if (spec.stack === "dimension") {
    if (spec.shape !== "seriesByDimension") return "按维度堆叠需要拆分趋势。";
    if (!first.additiveDimensions.includes(spec.dimension ?? ""))
      return "该指标不能按分组相加，不能堆叠。";
  }

  if (spec.compare && spec.shape === "seriesByDimension") return "拆分后的趋势不能叠加上一周期。";
  if (spec.sparkline && spec.shape !== "table") return "迷你趋势只用于表格。";

  if (spec.topN !== undefined && !spec.groups?.length) {
    const maximum =
      spec.shape === "breakdown"
        ? spec.dimension === "country"
          ? 250
          : catalog.limits.maxBreakdownTopN
        : spec.shape === "seriesByDimension"
          ? catalog.limits.maxDimensionTopN
          : spec.shape === "table"
            ? catalog.limits.maxTableTopN
            : 0;
    if (!maximum) return "此展示方式不需要分组数量。";
    if (spec.topN < 1 || spec.topN > maximum) return `分组数量需在 1 到 ${maximum} 之间。`;
  }
  if (spec.sort && !spec.metrics.includes(spec.sort)) return "排序指标必须是已选择的指标。";
  return null;
}

/** Validates a module against the catalog, including view rules that live on the module. */
export function validateCatalogWidget(widget: Widget, catalog: MetricCatalog): string | null {
  const spec = catalogSpecForWidget(widget);
  if (!spec) return null;
  const reason = validateCatalogSpec(spec, catalog);
  if (reason) return reason;
  if (widget.view === "donut") {
    const metric = catalog.metrics.find((entry) => entry.id === spec.metrics[0]);
    if (!metric?.additiveDimensions.includes(spec.dimension ?? ""))
      return "圆环图需要能按分组相加的指标。";
  }
  return null;
}

/** Metrics that can join the current selection without breaking a shared axis. */
export function compatibleMetric(
  candidate: CatalogMetric,
  selected: CatalogMetric[],
  table: boolean,
): string | null {
  if (!selected.length || selected.some((metric) => metric.id === candidate.id)) return null;
  if (candidate.source !== selected[0].source) return "来自不同数据来源";
  if (table) return null;
  return sharesAxis([...selected, candidate]) ? "单位或采样口径不同，无法共用坐标轴" : null;
}

/**
 * Drops whatever a change made invalid — a dimension the new metrics cannot be split by,
 * a filter their source does not have, a stacked view with nothing to stack — and reports
 * what it dropped, so a module never silently turns into one that cannot save.
 */
export function coerceCatalogWidget(
  widget: Widget,
  catalog: MetricCatalog,
): { widget: Widget; removed: string[] } {
  if (widget.data.source !== "catalog") return { widget, removed: [] };
  const data: CatalogData = { ...widget.data, filters: { ...widget.data.filters } };
  const removed: string[] = [];
  const metrics = data.metrics
    .map((id) => catalog.metrics.find((metric) => metric.id === id))
    .filter((metric): metric is CatalogMetric => Boolean(metric));
  const first = metrics[0];
  let view = widget.view;
  if (first) {
    if (!first.requiresMeasurementKey && data.measurement) {
      data.measurement = undefined;
      removed.push("数值名称");
    }
    if (data.dimension) {
      const property = data.dimension.startsWith("property:");
      const supported = property
        ? first.propertyDimensions
        : metrics.every((metric) => metric.dimensions.includes(data.dimension!));
      if (!supported) {
        removed.push(`分组维度「${catalogDimensionLabels[data.dimension] ?? data.dimension}」`);
        data.dimension = undefined;
      }
    }
    for (const key of Object.keys(data.filters) as CatalogFilterKey[]) {
      const value = data.filters[key];
      const clashes =
        key === data.dimension ||
        (data.dimension === "api" && (key === "apiMethod" || key === "apiUrl"));
      if (value && (!first.filters.includes(key) || clashes)) {
        delete data.filters[key];
        removed.push(`${catalogFilterLabels[key]}筛选`);
      }
    }
    if (data.groups && (!data.dimension || data.groups.length === 0)) {
      data.groups = undefined;
    }
    if (data.groups?.length) data.topN = undefined;
    if (data.sort && !data.metrics.includes(data.sort)) data.sort = undefined;
    const stacked = view === "stacked-area" || view === "stacked-bar";
    if (stacked) {
      const canStack = data.dimension
        ? first.additiveDimensions.includes(data.dimension)
        : metrics.length > 1 &&
          Boolean(first.compositionGroup) &&
          metrics.every((metric) => metric.compositionGroup === first.compositionGroup);
      if (!canStack) {
        view = view === "stacked-bar" ? "bar" : "area";
        removed.push("堆叠展示");
      }
    }
    if (data.compare && widget.type === "timeseries" && data.dimension) {
      data.compare = undefined;
      removed.push("上一周期对比");
    }
  }
  if (
    widget.type === "breakdown" ||
    widget.type === "ranked-table" ||
    widget.type === "metric-table"
  ) {
    if (!data.dimension && first) data.dimension = first.dimensions[0];
    if (view === "donut" && first && !first.additiveDimensions.includes(data.dimension ?? "")) {
      view = "bar";
      removed.push("圆环展示");
    }
  }
  return { widget: { ...widget, view, data }, removed };
}
