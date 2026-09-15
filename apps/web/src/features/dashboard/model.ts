import { z } from "zod";

export const MAX_WIDGETS = 24;
export const sizeLabels = { compact: "紧凑", half: "半宽", full: "整宽" } as const;
export const viewLabels = {
  number: "Stat",
  area: "Area",
  line: "Line",
  bar: "Bar",
  table: "Table",
  map: "世界地图",
} as const;
export type WidgetSize = keyof typeof sizeLabels;
export type WidgetView = keyof typeof viewLabels;
export type WidgetType = "stat" | "timeseries" | "breakdown" | "top-issues" | "slow-apis";

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
export const eventKindLabels: Record<string, string> = {
  page_view: "页面浏览",
  navigation: "路由导航",
  click: "点击",
  custom: "自定义事件",
};

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
]);

export const widgetSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    type: z.enum(["stat", "timeseries", "breakdown", "top-issues", "slow-apis"]),
    version: z.literal(1),
    title: boundedText(80).min(1),
    size: z.enum(["compact", "half", "full"]),
    view: z.enum(["number", "area", "line", "bar", "table", "map"]),
    data: dataSchema,
  })
  .superRefine((w, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (w.type === "stat") {
      if (w.size === "full" || w.view !== "number" || w.data.metrics.length !== 1)
        fail("指标卡使用紧凑或半宽布局，选择一个指标。");
    } else if (w.size === "compact") fail("图表和列表至少使用半宽布局。");
    if (w.type === "timeseries") {
      if (!["area", "line", "bar"].includes(w.view) || !w.data.metrics.length)
        fail("趋势图需要指标和 Area、Line 或 Bar 展示。");
    }
    if (
      w.type === "breakdown" &&
      (w.data.source !== "events" || !["bar", "table", "map"].includes(w.view))
    )
      fail("分布图支持事件数据的 Bar、Table 或国家地图展示。");
    if (w.view === "map" && !supportsWorldMap(w)) fail("世界地图仅支持按国家分组的事件分布。");
    if (
      ["top-issues", "slow-apis"].includes(w.type) &&
      (w.data.source !== "overview" || w.view !== "table" || w.data.metrics.length !== 0)
    )
      fail("列表使用概览来源，无需选择指标。");
    if (
      w.data.metrics.length === 2 &&
      !["pageViews,uniqueUsers", "errorRate,apiFailureRate"].includes(w.data.metrics.join(","))
    )
      fail("仅访问量与稳定性指标可使用内置双序列组合。");
  });
export type Widget = z.infer<typeof widgetSchema>;
export type WidgetData = Widget["data"];

export function supportsWorldMap(widget: Pick<Widget, "type" | "data">): boolean {
  return (
    widget.type === "breakdown" &&
    widget.data.source === "events" &&
    widget.data.dimension === "country"
  );
}

export function withBreakdownDimension(widget: Widget, dimension: string): Widget {
  if (widget.data.source !== "events") return widget;
  return {
    ...widget,
    view: widget.view === "map" && dimension !== "country" ? "bar" : widget.view,
    data: { ...widget.data, dimension },
  };
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
  const list = type === "top-issues" || type === "slow-apis";
  const titles: Record<WidgetType, string> = {
    stat: "PV",
    timeseries: "访问量",
    breakdown: "国家分布",
    "top-issues": "Top 问题",
    "slow-apis": "慢 API",
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

export function defaultDashboard(): DashboardConfig {
  const widgets: Widget[] = overviewMetricNames.map((metric) => ({
    ...createWidget("stat", {
      title: overviewMetricLabels[metric],
      data: { source: "overview", metrics: [metric] },
    }),
    id: `default-stat-${metric}`,
  }));
  widgets.push(
    { ...createWidget("timeseries"), id: "default-traffic" },
    {
      ...createWidget("timeseries", {
        title: "稳定性",
        view: "line",
        data: { source: "overview", metrics: ["errorRate", "apiFailureRate"] },
      }),
      id: "default-stability",
    },
    ...(["lcp", "inp", "cls"] as const).map((metric) => ({
      ...createWidget("timeseries", {
        title: `${overviewMetricLabels[metric]} 趋势`,
        view: "line",
        data: { source: "overview", metrics: [metric] },
      }),
      id: `default-trend-${metric}`,
    })),
    { ...createWidget("top-issues"), id: "default-issues" },
    { ...createWidget("slow-apis"), id: "default-apis" },
  );
  return { schemaVersion: 1, widgets };
}

export function metricLabel(data: WidgetData, name: string) {
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
  return widget.data.source === "overview"
    ? overviewStatDescriptions[widget.data.metrics[0]]
    : eventStatDescriptions[widget.data.metrics[0]];
}

export function widgetDescription(widget: Widget) {
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
  if (widget.type === "slow-apis") return "按 P95 请求耗时排序";
  return (
    widget.data.metrics.map((name) => metricLabel(widget.data, name)).join(" / ") +
    (widget.type === "stat" ? " · 当前时间范围" : " · 时间趋势")
  );
}
