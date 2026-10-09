import type { MetricCatalog } from "@/lib/api/metricsQuery";
import { defaultDashboard, defaultDashboardMetrics } from "./builtIn";
import { ecommerceDashboard, ecommerceMetrics } from "./ecommerce";
import { libraryEntry } from "./library";
import type { DashboardConfig } from "./model";

// Starting points for a new dashboard, composed from library entries so a module is defined
// once. A template is offered only when the catalog has every metric its entries read, so a
// new dashboard never starts broken.
export type DashboardTemplate = {
  id: string;
  name: string;
  description: string;
  metrics: string[];
  build: () => DashboardConfig;
};

function fromEntries(
  id: string,
  name: string,
  description: string,
  entries: string[],
): DashboardTemplate {
  return {
    id,
    name,
    description,
    metrics: [...new Set(entries.flatMap((entry) => libraryEntry(entry).requires))],
    build: () => ({
      schemaVersion: 1,
      widgets: entries.map((entry) => libraryEntry(entry).create()),
    }),
  };
}

export const dashboardTemplates: DashboardTemplate[] = [
  {
    id: "blank",
    name: "空白",
    description: "从零开始添加模块",
    metrics: [],
    build: () => ({ schemaVersion: 1, widgets: [] }),
  },
  {
    id: "default",
    name: "默认布局",
    description: "与内置默认仪表盘相同：核心指标、趋势、Top 页面、问题与慢 API",
    metrics: defaultDashboardMetrics(),
    build: defaultDashboard,
  },
  {
    id: "ecommerce",
    name: "电商经营概览",
    description:
      "收入、订单、客单价与购买漏斗，加来源、渠道收入和健康指标；需要 purchase 等事件和 amount 数值",
    metrics: ecommerceMetrics(),
    build: ecommerceDashboard,
  },
  fromEntries("traffic", "流量与会话", "会话、PV 与 UV，按页面、设备和国家拆分", [
    "sessions-stat",
    "page-views-stat",
    "users-stat",
    "sessions-trend",
    "device-traffic",
    "top-pages",
    "country-traffic",
  ]),
  fromEntries("performance", "性能", "LCP 走势、最慢的页面与各国性能", [
    "lcp-stat",
    "vitals-trend",
    "slowest-pages",
    "country-vitals",
  ]),
  fromEntries("api", "API 健康", "请求量、请求结果构成、延迟分位与慢 API", [
    "api-volume",
    "api-outcomes",
    "api-latency",
    "slow-apis",
    "failing-apis",
  ]),
  fromEntries("errors", "错误分析", "错误率、新增 Issue、错误类型与受影响浏览器", [
    "error-rate-stat",
    "new-issues",
    "error-types",
    "browser-errors",
    "release-errors",
    "top-issues",
  ]),
  fromEntries("business", "业务指标", "以自定义事件的 amount 数值为例：总和、客单价与分布", [
    "revenue-stat",
    "order-value-stat",
    "revenue-trend",
    "amount-spread",
    "country-revenue",
  ]),
];

export function availableTemplates(catalog: MetricCatalog | undefined): DashboardTemplate[] {
  const known = new Set(catalog?.metrics.map((metric) => metric.id) ?? []);
  return dashboardTemplates.filter((template) =>
    template.metrics.every((metric) => known.has(metric)),
  );
}
