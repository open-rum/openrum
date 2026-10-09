import { libraryEntry } from "./library";
import { createCatalogWidget, type DashboardConfig, type Widget } from "./model";

// The e-commerce overview: revenue, orders and the purchase funnel on top of the usual health
// numbers. It reads Custom Events named view_item, add_to_cart, begin_checkout and purchase,
// and the `amount` measurement of purchase for revenue, so it is a template to start from
// rather than part of the built-in default, which every Project sees whatever it sells.

const purchase = { eventName: "purchase" };
const stat = (
  title: string,
  data: Parameters<typeof createCatalogWidget>[1],
  appearance: "plain" | "area-right" = "area-right",
) => createCatalogWidget("stat", data, { title, statAppearance: appearance });
/** Revenue-like cards read as good news when they rise. */
const rising = { direction: "up" as const };

export function ecommerceWidgets(): Widget[] {
  return [
    stat("收入", {
      metrics: ["measurement.sum"],
      measurement: "amount",
      filters: purchase,
      ...rising,
    }),
    stat("订单数", {
      metrics: ["behavior.events"],
      filters: { eventKind: "custom", eventName: "purchase" },
      ...rising,
    }),
    stat("客单价", {
      metrics: ["measurement.avg"],
      measurement: "amount",
      filters: purchase,
      ...rising,
    }),
    stat("访客数", { metrics: ["traffic.uniqueUsers"] }),
    stat("会话数", { metrics: ["traffic.sessions"] }),
    stat("错误率", { metrics: ["traffic.errorRate"] }),
    stat("API 失败率", { metrics: ["traffic.apiFailureRate"] }),
    stat("LCP P75", { metrics: ["vitals.lcpP75"] }, "plain"),
    createCatalogWidget(
      "timeseries",
      {
        metrics: ["measurement.sum"],
        measurement: "amount",
        filters: purchase,
        compare: "previous",
      },
      { title: "收入趋势", view: "area" },
    ),
    createCatalogWidget(
      "timeseries",
      {
        metrics: ["behavior.events"],
        dimension: "eventName",
        filters: { eventKind: "custom" },
        groups: ["view_item", "add_to_cart", "begin_checkout", "purchase"],
      },
      { title: "购买漏斗事件", view: "line" },
    ),
    createCatalogWidget(
      "breakdown",
      { metrics: ["behavior.events"], dimension: "source", filters: { eventKind: "page_view" } },
      { title: "访问来源", view: "donut" },
    ),
    createCatalogWidget(
      "timeseries",
      { metrics: ["traffic.pageViews", "traffic.uniqueUsers"] },
      { title: "访问量", view: "area" },
    ),
    createCatalogWidget(
      "breakdown",
      {
        metrics: ["measurement.sum"],
        measurement: "amount",
        dimension: "source",
        filters: purchase,
      },
      { title: "各渠道收入", view: "bar", size: "third" },
    ),
    createCatalogWidget(
      "breakdown",
      { metrics: ["traffic.pageViews"], dimension: "device" },
      { title: "设备分布", view: "donut", size: "third" },
    ),
    createCatalogWidget(
      "breakdown",
      { metrics: ["traffic.pageViews"], dimension: "browser" },
      { title: "浏览器分布", view: "donut", size: "third" },
    ),
    libraryEntry("top-pages").create(),
    libraryEntry("slow-apis").create(),
    libraryEntry("top-issues").create(),
    libraryEntry("vitals-trend").create(),
  ];
}

export function ecommerceDashboard(): DashboardConfig {
  return { schemaVersion: 1, widgets: ecommerceWidgets() };
}

/** Catalog metrics the template reads, so it is offered only where they exist. */
export function ecommerceMetrics(): string[] {
  return [
    ...new Set(
      ecommerceWidgets().flatMap((widget) =>
        widget.data.source === "catalog" ? widget.data.metrics : [],
      ),
    ),
  ];
}
