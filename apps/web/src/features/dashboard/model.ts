import { z } from "zod";

export const MAX_WIDGETS = 24;
export const statAppearanceLabels = {
  plain: "简洁数值",
  "line-right": "右侧折线",
  "bar-right": "右侧柱状图",
} as const;
export type StatAppearance = keyof typeof statAppearanceLabels;
export const sizeLabels = { compact: "紧凑", half: "半宽", full: "整宽" } as const;
export const viewLabels = {
  number: "Stat",
  area: "Area",
  line: "Line",
  bar: "Bar",
  table: "Table",
  donut: "圆环 + 列表",
  "stacked-area": "堆叠面积",
  "stacked-bar": "堆叠柱状图",
} as const;
export type WidgetSize = keyof typeof sizeLabels;
export type WidgetView = keyof typeof viewLabels;
export type WidgetType =
  "stat" | "timeseries" | "breakdown" | "top-issues" | "ranked-table" | "metric-table";

const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\0\r\n]/.test(v));
export const overviewMetricNames = [
  "pageViews",
  "uniqueUsers",
  "errorRate",
  "apiFailureRate",
  "lcp",
  "inp",
  "cls",
] as const;
export const eventMetricNames = ["estimated", "uniqueUsers", "uniqueSessions"] as const;
export const overviewMetricLabels: Record<string, string> = {
  pageViews: "PV",
  uniqueUsers: "UV",
  errorRate: "错误率",
  apiFailureRate: "API 失败率",
  lcp: "LCP P75",
  inp: "INP P75",
  cls: "CLS P75",
};
export const eventMetricLabels: Record<string, string> = {
  estimated: "事件次数（估算）",
  uniqueUsers: "用户数",
  uniqueSessions: "会话数",
};
export const dimensionLabels: Record<string, string> = {
  country: "国家",
  device: "设备",
  browser: "浏览器",
  source: "来源",
};
export const catalogDimensionLabels: Record<string, string> = {
  route: "页面路由",
  release: "版本",
  country: "国家/地区",
  browser: "浏览器",
  device: "设备类型",
  api: "API",
  apiMethod: "请求方法",
  errorType: "错误类型",
  source: "来源",
  eventName: "事件名称",
};
export const eventKindLabels: Record<string, string> = {
  page_view: "页面浏览",
  navigation: "路由导航",
  click: "点击",
  custom: "自定义事件",
};

// Catalog metric ids come from internal/catalog, e.g. "traffic.sessions" or "api.durationP95".
export const catalogMetricId = z.string().regex(/^[a-z]+\.[a-zA-Z0-9]+$/);
const measurementKey = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
export const catalogFilterKeys = [
  "release",
  "route",
  "country",
  "browser",
  "device",
  "apiMethod",
  "apiUrl",
  "eventKind",
  "eventName",
] as const;
export type CatalogFilterKey = (typeof catalogFilterKeys)[number];
const catalogFiltersSchema = z.strictObject({
  release: boundedText(128).optional(),
  route: boundedText(512).optional(),
  country: z
    .string()
    .regex(/^([A-Z]{2}|unknown)$/)
    .optional(),
  browser: boundedText(64).optional(),
  device: boundedText(64).optional(),
  apiMethod: z
    .string()
    .regex(/^[A-Z]{1,16}$/)
    .optional(),
  apiUrl: boundedText(2048).optional(),
  eventKind: z.enum(["page_view", "navigation", "click", "custom"]).optional(),
  eventName: boundedText(80).optional(),
});

const dataSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("overview"),
    metrics: z.array(z.enum(overviewMetricNames)).max(2),
    release: boundedText(128).optional(),
    route: boundedText(512).optional(),
  }),
  z.strictObject({
    source: z.literal("events"),
    metrics: z.array(z.enum(eventMetricNames)).length(1),
    eventKind: z.enum(["page_view", "navigation", "click", "custom"]).optional(),
    eventName: boundedText(80).optional(),
    dimension: z.union([
      z.enum(["country", "device", "browser", "source"]),
      z.string().regex(/^property:[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    ]),
  }),
  // Version 2 modules name metrics from the backend catalog. Which combinations are
  // meaningful (units, weighting, additivity) is checked against the catalog itself in
  // catalogRules.ts; this schema only checks shape.
  z.strictObject({
    source: z.literal("catalog"),
    metrics: z.array(catalogMetricId).min(1).max(6),
    dimension: z
      .string()
      .regex(/^([a-zA-Z]{1,32}|property:[a-zA-Z][a-zA-Z0-9_.-]{0,63})$/)
      .optional(),
    measurement: z.string().regex(measurementKey).optional(),
    filters: catalogFiltersSchema,
    compare: z.literal("previous").optional(),
    topN: z.number().int().min(1).max(250).optional(),
    sort: catalogMetricId.optional(),
    order: z.enum(["asc", "desc"]).optional(),
    sparkline: z.boolean().optional(),
    // Pinned groups of the split dimension, drawn in this order instead of the top N.
    groups: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(512)
          .refine((v) => !/\p{Cc}/u.test(v)),
      )
      .min(1)
      .max(50)
      .optional(),
  }),
]);

export const widgetSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    type: z.enum(["stat", "timeseries", "breakdown", "top-issues", "ranked-table", "metric-table"]),
    // Catalog modules are version 2 so an older deployment keeps them verbatim instead of
    // rejecting the whole dashboard.
    version: z.union([z.literal(1), z.literal(2)]),
    title: boundedText(80).min(1),
    size: z.enum(["compact", "half", "full"]),
    view: z
      .enum([
        "number",
        "area",
        "line",
        "bar",
        "table",
        "map",
        "donut",
        "stacked-area",
        "stacked-bar",
      ])
      // The world map view was retired. A saved one reads as ranked bars and saves as bars.
      .transform((value) => (value === "map" ? "bar" : value)),
    statAppearance: z
      .enum(["plain", "line-right", "bar-right", "line-bottom", "area-bottom"])
      // Keep saved bottom variants readable without continuing to render them.
      .transform((value): StatAppearance =>
        value === "line-bottom" || value === "area-bottom" ? "line-right" : value,
      )
      .optional(),
    data: dataSchema,
  })
  .superRefine((w, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const catalog = w.data.source === "catalog";
    if (catalog !== (w.version === 2)) fail("指标目录模块使用第 2 版配置。");
    if ((w.type === "ranked-table" || w.type === "metric-table") && !catalog)
      fail("排行表和指标表读取指标目录。");
    if (w.type !== "stat" && w.statAppearance !== undefined) fail("卡片外观仅适用于指标卡。");
    if (w.type === "stat") {
      if (w.size === "full" || w.view !== "number" || w.data.metrics.length !== 1)
        fail("指标卡使用紧凑或半宽布局，选择一个指标。");
    } else if (w.size === "compact") fail("图表和列表至少使用半宽布局。");
    if (w.type === "timeseries") {
      const views = catalog
        ? ["area", "line", "bar", "stacked-area", "stacked-bar"]
        : ["area", "line", "bar"];
      if (!views.includes(w.view) || !w.data.metrics.length)
        fail("趋势图需要指标和 Area、Line 或 Bar 展示。");
    } else if (w.view === "stacked-area" || w.view === "stacked-bar") {
      fail("堆叠展示仅适用于趋势图。");
    }
    if (
      w.type === "breakdown" &&
      (w.data.source === "overview" || !["bar", "table", "donut"].includes(w.view))
    )
      fail("分布图支持事件或指标目录数据的 Bar、Table 或圆环列表展示。");
    if (w.type === "ranked-table" || w.type === "metric-table") {
      if (w.view !== "table") fail("排行表和指标表使用表格展示。");
      if (w.data.source === "catalog" && !w.data.dimension) fail("表格需要选择一个分组维度。");
      if (w.type === "ranked-table" && w.data.metrics.length !== 1) fail("排行表只展示一个指标。");
    }
    if (
      w.type === "top-issues" &&
      (w.data.source !== "overview" || w.view !== "table" || w.data.metrics.length !== 0)
    )
      fail("列表使用概览来源，无需选择指标。");
    if (
      w.data.source === "overview" &&
      w.data.metrics.length === 2 &&
      !["pageViews,uniqueUsers", "errorRate,apiFailureRate"].includes(w.data.metrics.join(","))
    )
      fail("仅访问量与稳定性指标可使用内置双序列组合。");
  });
export type Widget = z.infer<typeof widgetSchema>;
export type WidgetData = Widget["data"];

export function withBreakdownDimension(widget: Widget, dimension: string): Widget {
  if (widget.data.source !== "catalog" && widget.data.source !== "events") return widget;
  return { ...widget, data: { ...widget.data, dimension } } as Widget;
}

// Read permissively to retain modules from a newer deployment. They are never
// executed until a registered definition validates their type and version.
export const storedWidgetSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  type: z.string(),
  version: z.number().int(),
});
export type StoredWidget = z.infer<typeof storedWidgetSchema>;
export const dashboardConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  widgets: z.array(storedWidgetSchema),
});
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;
export const dashboardResponseSchema = z.object({
  config: dashboardConfigSchema.nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

export function readWidget(record: StoredWidget): Widget | undefined {
  const parsed = widgetSchema.safeParse(record);
  return parsed.success ? parsed.data : undefined;
}

export function createWidget(
  type: WidgetType,
  overrides: Partial<Omit<Widget, "type" | "version" | "id">> = {},
): Widget {
  const list = type === "top-issues";
  if (type === "ranked-table" || type === "metric-table")
    return createCatalogWidget(type, {
      metrics:
        type === "ranked-table"
          ? ["traffic.pageViews"]
          : ["traffic.pageViews", "traffic.errorRate"],
      dimension: "route",
    });
  const titles: Record<WidgetType, string> = {
    stat: "PV",
    timeseries: "访问量",
    breakdown: "国家分布",
    "top-issues": "Top 问题",
    "ranked-table": "Top 页面",
    "metric-table": "页面概况",
  };
  return widgetSchema.parse({
    id: crypto.randomUUID(),
    type,
    version: 1,
    title: titles[type],
    size: type === "stat" ? "compact" : "half",
    view:
      type === "stat"
        ? "number"
        : type === "timeseries"
          ? "area"
          : type === "breakdown"
            ? "bar"
            : "table",
    data:
      type === "breakdown"
        ? { source: "events", metrics: ["estimated"], dimension: "country" }
        : {
            source: "overview",
            metrics: list
              ? []
              : type === "timeseries"
                ? ["pageViews", "uniqueUsers"]
                : ["pageViews"],
          },
    ...overrides,
  });
}

type CatalogData = Extract<WidgetData, { source: "catalog" }>;

/** Builds a version 2 module over the metric catalog. */
export function createCatalogWidget(
  type: Exclude<WidgetType, "top-issues">,
  data: Omit<CatalogData, "source" | "filters"> & { filters?: CatalogData["filters"] },
  overrides: Partial<Omit<Widget, "type" | "version" | "id" | "data">> = {},
): Widget {
  const table = type === "ranked-table" || type === "metric-table";
  return widgetSchema.parse({
    id: crypto.randomUUID(),
    type,
    version: 2,
    title: table ? (type === "ranked-table" ? "Top 页面" : "页面概况") : "指标",
    size: type === "stat" ? "compact" : type === "metric-table" ? "full" : "half",
    view: type === "stat" ? "number" : table ? "table" : type === "breakdown" ? "bar" : "line",
    ...overrides,
    data: { source: "catalog", filters: {}, ...data },
  });
}

/**
 * Slowest APIs by P95, with volume and failure rate beside it. Groups with too few samples
 * rank last, so one slow outlier request cannot top the list.
 */
export function slowApiModule(): Widget {
  return createCatalogWidget(
    "metric-table",
    {
      metrics: ["api.durationP95", "api.requests", "api.failureRate"],
      dimension: "api",
      sort: "api.durationP95",
      topN: 10,
    },
    { title: "慢 API", size: "half" },
  );
}

/** Labels for catalog metrics, filled from the catalog once it has loaded. */
const catalogLabels = new Map<string, string>();
export function rememberCatalogLabels(metrics: Array<{ id: string; label: string }>) {
  for (const metric of metrics) catalogLabels.set(metric.id, metric.label);
}

export function metricLabel(data: WidgetData, name: string) {
  if (data.source === "catalog") return catalogLabels.get(name) ?? name;
  return (data.source === "overview" ? overviewMetricLabels : eventMetricLabels)[name] ?? name;
}

const overviewStatDescriptions: Record<(typeof overviewMetricNames)[number], string> = {
  pageViews: "页面浏览次数",
  uniqueUsers: "访问过站点的独立用户",
  errorRate: "错误事件数占页面浏览量的比例",
  apiFailureRate: "失败请求占全部 API 请求的比例",
  lcp: "主要内容加载耗时 · P75",
  inp: "交互响应耗时 · P75",
  cls: "页面布局偏移 · P75",
};
const eventStatDescriptions: Record<(typeof eventMetricNames)[number], string> = {
  estimated: "事件触发次数（估算）",
  uniqueUsers: "触发这些事件的独立用户",
  uniqueSessions: "触发这些事件的会话数量",
};

export function statDescription(widget: Widget): string {
  if (widget.data.source === "catalog") return metricLabel(widget.data, widget.data.metrics[0]);
  return widget.data.source === "overview"
    ? overviewStatDescriptions[widget.data.metrics[0]]
    : eventStatDescriptions[widget.data.metrics[0]];
}

export function widgetDescription(widget: Widget) {
  if (widget.data.source === "catalog") {
    const { metrics, dimension } = widget.data;
    const split = dimension
      ? (catalogDimensionLabels[dimension] ?? dimension.replace(/^property:/, ""))
      : undefined;
    return [metrics.map((name) => metricLabel(widget.data, name)).join(" / "), split]
      .filter(Boolean)
      .join(" · 按");
  }
  if (widget.data.source === "events") {
    const { eventKind, eventName, dimension } = widget.data;
    return [
      eventKind ? eventKindLabels[eventKind] : "全部行为事件",
      eventName,
      widget.type === "breakdown" ? (dimensionLabels[dimension] ?? dimension.slice(9)) : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (widget.type === "top-issues") return "按受影响用户排序";
  return (
    widget.data.metrics.map((name) => metricLabel(widget.data, name)).join(" / ") +
    (widget.type === "stat" ? " · 当前时间范围" : " · 时间趋势")
  );
}
