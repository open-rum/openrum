import type { MetricCatalog } from "@/lib/api/metricsQuery";
import { createCatalogWidget, createWidget, slowApiModule, type Widget } from "./model";

// The module library, organized by what the reader wants to look at rather than by chart
// type. Every concrete module lives in exactly one domain; "recommended" is a filter over
// them, not a second copy. Dimensions such as country or browser are choices inside a
// module, not modules of their own.

export type LibraryDomain =
  "traffic" | "performance" | "api" | "errors" | "business" | "behavior" | "custom";
export type LibraryPreview =
  "stat" | "line" | "stacked" | "bars" | "donut" | "ranked" | "matrix" | "list";

export type LibraryEntry = {
  id: string;
  name: string;
  description: string;
  domain: LibraryDomain;
  recommended?: boolean;
  preview: LibraryPreview;
  /** Catalog metrics the module reads. Empty for event and classic-list modules. */
  requires: string[];
  create: () => Widget;
};

export const libraryDomains: Array<{ id: LibraryDomain | "recommended"; label: string }> = [
  { id: "recommended", label: "推荐" },
  { id: "traffic", label: "流量与会话" },
  { id: "performance", label: "性能" },
  { id: "api", label: "API" },
  { id: "errors", label: "错误" },
  { id: "business", label: "业务指标" },
  { id: "behavior", label: "用户行为" },
  { id: "custom", label: "自定义" },
];

const stat = (metric: string, title: string, measurement?: string) =>
  createCatalogWidget(
    "stat",
    { metrics: [metric], measurement },
    { title, statAppearance: "line-right" },
  );

export const library: LibraryEntry[] = [
  // Traffic and Sessions
  {
    id: "sessions-stat",
    name: "会话数",
    description: "发生过页面浏览的会话，附上一周期对比",
    domain: "traffic",
    preview: "stat",
    requires: ["traffic.sessions"],
    create: () => stat("traffic.sessions", "会话数"),
  },
  {
    id: "page-views-stat",
    name: "PV",
    description: "页面浏览次数（按采样率还原）",
    domain: "traffic",
    preview: "stat",
    requires: ["traffic.pageViews"],
    create: () => stat("traffic.pageViews", "PV"),
  },
  {
    id: "users-stat",
    name: "UV",
    description: "访问过站点的独立用户",
    domain: "traffic",
    preview: "stat",
    requires: ["traffic.uniqueUsers"],
    create: () => stat("traffic.uniqueUsers", "UV"),
  },
  {
    id: "sessions-trend",
    name: "会话趋势",
    description: "会话走势，叠加上一周期虚线",
    domain: "traffic",
    recommended: true,
    preview: "line",
    requires: ["traffic.sessions"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["traffic.sessions"], compare: "previous" },
        { title: "会话趋势", view: "line" },
      ),
  },
  {
    id: "device-traffic",
    name: "各设备 PV",
    description: "PV 按设备类型堆叠",
    domain: "traffic",
    recommended: true,
    preview: "stacked",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["traffic.pageViews"], dimension: "device", topN: 5 },
        { title: "各设备 PV", view: "stacked-bar" },
      ),
  },
  {
    id: "top-pages",
    name: "Top 页面",
    description: "PV 最多的页面，带变化与迷你趋势",
    domain: "traffic",
    recommended: true,
    preview: "ranked",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "ranked-table",
        { metrics: ["traffic.pageViews"], dimension: "route" },
        { title: "Top 页面" },
      ),
  },
  {
    id: "country-traffic",
    name: "各国 PV",
    description: "PV 最多的国家/地区排行，带占比",
    domain: "traffic",
    recommended: true,
    preview: "bars",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "breakdown",
        { metrics: ["traffic.pageViews"], dimension: "country" },
        { title: "各国 PV", view: "bar" },
      ),
  },
  {
    id: "browser-share",
    name: "浏览器分布",
    description: "各浏览器的 PV 与占比",
    domain: "traffic",
    preview: "donut",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "breakdown",
        { metrics: ["traffic.pageViews"], dimension: "browser" },
        { title: "浏览器分布", view: "donut" },
      ),
  },

  // Performance
  {
    id: "lcp-stat",
    name: "LCP P75",
    description: "主要内容加载耗时，可在配置中切换 INP、CLS",
    domain: "performance",
    preview: "stat",
    requires: ["vitals.lcpP75"],
    create: () => stat("vitals.lcpP75", "LCP P75"),
  },
  {
    id: "vitals-trend",
    name: "Web Vitals 趋势",
    description: "LCP P75 走势与良好 / 较差阈值线",
    domain: "performance",
    preview: "line",
    requires: ["vitals.lcpP75"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["vitals.lcpP75"] },
        { title: "LCP 趋势", view: "line" },
      ),
  },
  {
    id: "slowest-pages",
    name: "最慢的页面",
    description: "LCP P75 最高的页面；样本不足的排在后面",
    domain: "performance",
    preview: "ranked",
    requires: ["vitals.lcpP75"],
    create: () =>
      createCatalogWidget(
        "ranked-table",
        { metrics: ["vitals.lcpP75"], dimension: "route" },
        { title: "最慢的页面" },
      ),
  },
  {
    id: "country-vitals",
    name: "各国性能",
    description: "按国家并排查看 LCP、INP、CLS",
    domain: "performance",
    preview: "matrix",
    requires: ["vitals.lcpP75", "vitals.inpP75", "vitals.clsP75"],
    create: () =>
      createCatalogWidget(
        "metric-table",
        { metrics: ["vitals.lcpP75", "vitals.inpP75", "vitals.clsP75"], dimension: "country" },
        { title: "各国性能", size: "full" },
      ),
  },

  // API
  {
    id: "api-outcomes",
    name: "API 请求结果构成",
    description: "4xx、5xx 与网络错误各占全部请求的比例；4xx 不计入失败",
    domain: "api",
    recommended: true,
    preview: "stacked",
    requires: ["api.clientErrorRate", "api.serverErrorRate", "api.networkErrorRate"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["api.clientErrorRate", "api.serverErrorRate", "api.networkErrorRate"] },
        { title: "API 请求结果构成", view: "stacked-area" },
      ),
  },
  {
    id: "api-latency",
    name: "API 延迟分位",
    description: "P50、P75 与 P95 请求耗时",
    domain: "api",
    preview: "line",
    requires: ["api.durationP50", "api.durationP75", "api.durationP95"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["api.durationP50", "api.durationP75", "api.durationP95"] },
        { title: "API 延迟分位", view: "line" },
      ),
  },
  {
    id: "slow-apis",
    name: "慢 API",
    description: "按 P95 耗时排序，并列请求数与失败率",
    domain: "api",
    recommended: true,
    preview: "matrix",
    requires: ["api.durationP95", "api.requests", "api.failureRate"],
    create: slowApiModule,
  },
  {
    id: "failing-apis",
    name: "失败率最高的 API",
    description: "失败率排行，带变化与迷你趋势",
    domain: "api",
    preview: "ranked",
    requires: ["api.failureRate"],
    create: () =>
      createCatalogWidget(
        "ranked-table",
        { metrics: ["api.failureRate"], dimension: "api" },
        { title: "失败率最高的 API" },
      ),
  },
  {
    id: "api-volume",
    name: "API 请求量趋势",
    description: "请求量走势，叠加上一周期虚线",
    domain: "api",
    preview: "line",
    requires: ["api.requests"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["api.requests"], compare: "previous" },
        { title: "API 请求量", view: "area" },
      ),
  },

  // Errors
  {
    id: "error-rate-stat",
    name: "错误率",
    description: "错误事件数占页面浏览量的比例",
    domain: "errors",
    preview: "stat",
    requires: ["traffic.errorRate"],
    create: () => stat("traffic.errorRate", "错误率"),
  },
  {
    id: "new-issues",
    name: "新增 Issue",
    description: "首次出现或沉寂 30 天后复发的 Issue",
    domain: "errors",
    recommended: true,
    preview: "stat",
    requires: ["issues.newIssues"],
    create: () =>
      createCatalogWidget(
        "stat",
        { metrics: ["issues.newIssues"] },
        { title: "新增 Issue", statAppearance: "bar-right" },
      ),
  },
  {
    id: "error-types",
    name: "错误类型构成",
    description: "错误事件按错误类型堆叠",
    domain: "errors",
    recommended: true,
    preview: "stacked",
    requires: ["issues.events"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["issues.events"], dimension: "errorType", topN: 5 },
        { title: "错误类型构成", view: "stacked-area" },
      ),
  },
  {
    id: "browser-errors",
    name: "各浏览器错误率",
    description: "错误率最高的浏览器，带变化与迷你趋势",
    domain: "errors",
    preview: "ranked",
    requires: ["traffic.errorRate"],
    create: () =>
      createCatalogWidget(
        "ranked-table",
        { metrics: ["traffic.errorRate"], dimension: "browser" },
        { title: "各浏览器错误率" },
      ),
  },
  {
    id: "release-errors",
    name: "各版本错误",
    description: "按版本并排查看错误事件、受影响用户与活跃 Issue",
    domain: "errors",
    preview: "matrix",
    requires: ["issues.events", "issues.users", "issues.activeIssues"],
    create: () =>
      createCatalogWidget(
        "metric-table",
        { metrics: ["issues.events", "issues.users", "issues.activeIssues"], dimension: "release" },
        { title: "各版本错误", size: "full" },
      ),
  },
  {
    id: "top-issues",
    name: "Top 问题",
    description: "事件最多的 Issue，点击进入详情",
    domain: "errors",
    preview: "list",
    requires: [],
    create: () => createWidget("top-issues"),
  },

  // Business metrics
  {
    id: "revenue-stat",
    name: "收入总和",
    description: "自定义事件 amount 数值的总和",
    domain: "business",
    preview: "stat",
    requires: ["measurement.sum"],
    create: () => stat("measurement.sum", "收入总和", "amount"),
  },
  {
    id: "order-value-stat",
    name: "客单价",
    description: "amount 数值的平均值",
    domain: "business",
    preview: "stat",
    requires: ["measurement.avg"],
    create: () => stat("measurement.avg", "客单价", "amount"),
  },
  {
    id: "revenue-trend",
    name: "收入趋势",
    description: "amount 总和走势，叠加上一周期虚线",
    domain: "business",
    preview: "line",
    requires: ["measurement.sum"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["measurement.sum"], measurement: "amount", compare: "previous" },
        { title: "收入趋势", view: "area" },
      ),
  },
  {
    id: "amount-spread",
    name: "金额分布",
    description: "amount 的 P50、P90 与平均值",
    domain: "business",
    preview: "line",
    requires: ["measurement.p50", "measurement.p90", "measurement.avg"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        {
          metrics: ["measurement.p50", "measurement.p90", "measurement.avg"],
          measurement: "amount",
        },
        { title: "金额分布", view: "line" },
      ),
  },
  {
    id: "country-revenue",
    name: "各国收入",
    description: "amount 总和按国家排行",
    domain: "business",
    preview: "bars",
    requires: ["measurement.sum"],
    create: () =>
      createCatalogWidget(
        "breakdown",
        { metrics: ["measurement.sum"], measurement: "amount", dimension: "country" },
        { title: "各国收入", view: "bar" },
      ),
  },

  // Behavior events
  {
    id: "event-compare",
    name: "事件对比趋势",
    description: "几个事件各画一条线，如发起支付、支付成功、支付失败",
    domain: "behavior",
    preview: "line",
    requires: ["behavior.events"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        {
          metrics: ["behavior.events"],
          dimension: "eventName",
          filters: { eventKind: "custom" },
        },
        { title: "事件对比", view: "line" },
      ),
  },
  {
    id: "top-custom-events",
    name: "Top 自定义事件",
    description: "触发次数最多的自定义事件，带变化与迷你趋势",
    domain: "behavior",
    preview: "ranked",
    requires: ["behavior.events"],
    create: () =>
      createCatalogWidget(
        "ranked-table",
        { metrics: ["behavior.events"], dimension: "eventName", filters: { eventKind: "custom" } },
        { title: "Top 自定义事件" },
      ),
  },
  {
    id: "custom-events-stat",
    name: "自定义事件总数",
    description: "自定义事件的触发次数（估算），可按事件名称筛选",
    domain: "behavior",
    preview: "stat",
    requires: ["behavior.events"],
    create: () =>
      createCatalogWidget(
        "stat",
        { metrics: ["behavior.events"], filters: { eventKind: "custom" } },
        { title: "自定义事件", statAppearance: "line-right" },
      ),
  },
  {
    id: "clicks-trend",
    name: "点击趋势",
    description: "页面点击次数走势，叠加上一周期虚线",
    domain: "behavior",
    preview: "line",
    requires: ["behavior.events"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["behavior.events"], filters: { eventKind: "click" }, compare: "previous" },
        { title: "点击趋势", view: "line" },
      ),
  },
  {
    id: "traffic-sources",
    name: "来源分布",
    description: "页面浏览来自哪些来源域名",
    domain: "behavior",
    preview: "donut",
    requires: ["behavior.events"],
    create: () =>
      createCatalogWidget(
        "breakdown",
        { metrics: ["behavior.events"], dimension: "source", filters: { eventKind: "page_view" } },
        { title: "来源分布", view: "donut" },
      ),
  },

  // Blank modules, configured from scratch over the metric catalog.
  {
    id: "blank-stat",
    name: "指标卡",
    description: "一个指标在当前时间范围的数值",
    domain: "custom",
    preview: "stat",
    requires: ["traffic.pageViews"],
    create: () => createCatalogWidget("stat", { metrics: ["traffic.pageViews"] }, { title: "PV" }),
  },
  {
    id: "blank-trend",
    name: "时间趋势",
    description: "一个或多个指标随时间的变化，可拆分或堆叠",
    domain: "custom",
    preview: "line",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["traffic.pageViews"] },
        { title: "PV 趋势", view: "line" },
      ),
  },
  {
    id: "blank-breakdown",
    name: "维度分布",
    description: "一个指标按维度排行，可切换为表格、圆环或地图",
    domain: "custom",
    preview: "bars",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "breakdown",
        { metrics: ["traffic.pageViews"], dimension: "country" },
        { title: "PV 分布", view: "bar" },
      ),
  },
  {
    id: "blank-ranked",
    name: "排行表",
    description: "一个指标按分组排行，带变化与迷你趋势",
    domain: "custom",
    preview: "ranked",
    requires: ["traffic.pageViews"],
    create: () =>
      createCatalogWidget(
        "ranked-table",
        { metrics: ["traffic.pageViews"], dimension: "route" },
        { title: "排行" },
      ),
  },
  {
    id: "blank-matrix",
    name: "指标表",
    description: "多个指标按分组并排，可按任一列排序",
    domain: "custom",
    preview: "matrix",
    requires: ["traffic.pageViews", "traffic.errorRate"],
    create: () =>
      createCatalogWidget(
        "metric-table",
        { metrics: ["traffic.pageViews", "traffic.errorRate"], dimension: "route" },
        { title: "指标表" },
      ),
  },
];

export function libraryEntry(id: string): LibraryEntry {
  const entry = library.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`unknown library entry ${id}`);
  return entry;
}

/**
 * Entries this catalog can serve. While the catalog loads, only entries that do not need
 * it are available; an entry is hidden if the catalog lacks any metric it reads.
 */
export function availableEntries(catalog: MetricCatalog | undefined): LibraryEntry[] {
  const known = new Set(catalog?.metrics.map((metric) => metric.id) ?? []);
  return library.filter((entry) => entry.requires.every((metric) => known.has(metric)));
}
