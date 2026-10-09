import { libraryEntry } from "./library";
import type { DashboardSummary } from "@/lib/api/dashboards";
import { createCatalogWidget, type StatAppearance, type Widget } from "./model";

// The built-in default dashboard is defined here in code and never stored. Everyone sees
// the same layout until they change it; saving a change creates a personal dashboard and
// leaves the default untouched, for this person and everyone else.
export const BUILT_IN_DASHBOARD_ID = "default";
export const BUILT_IN_DASHBOARD_NAME = "默认仪表盘";
/** The name a personal dashboard saved from the default starts with. */
export const PERSONAL_DASHBOARD_NAME = "我的仪表盘";

export function isBuiltInDashboard(id: string | undefined) {
  return id === BUILT_IN_DASHBOARD_ID;
}

// Fixed ids keep React keys and open details stable across renders. Ids only need to be
// unique within one dashboard, so a saved copy may keep them.
const fixed = (id: string, widget: Widget): Widget => ({ ...widget, id: `default-${id}` });

const stat = (id: string, metric: string, title: string, appearance: StatAppearance) =>
  fixed(
    id,
    createCatalogWidget("stat", { metrics: [metric] }, { title, statAppearance: appearance }),
  );

const entry = (id: string, library: string) => fixed(id, libraryEntry(library).create());

/**
 * Health at a glance, then the trends behind it, then what to act on. The default also
 * shows every kind of module once, so a new Project sees what dashboards can draw: both
 * stat card styles (plain and right-side area); line (with the previous period), area, bar, stacked-bar and
 * stacked-area trends; ranked bars, a table and a donut; a ranked table, a metric table
 * and the Top Issues list. Half-width modules are ordered in pairs so rows stay full.
 */
export function defaultDashboard(): { schemaVersion: 1; widgets: Widget[] } {
  return {
    schemaVersion: 1,
    widgets: [
      stat("sessions", "traffic.sessions", "会话数", "area-right"),
      stat("page-views", "traffic.pageViews", "PV", "area-right"),
      stat("users", "traffic.uniqueUsers", "UV", "area-right"),
      stat("error-rate", "traffic.errorRate", "错误率", "area-right"),
      stat("api-failure-rate", "traffic.apiFailureRate", "API 失败率", "area-right"),
      stat("lcp", "vitals.lcpP75", "LCP P75", "plain"),
      stat("inp", "vitals.inpP75", "INP P75", "plain"),
      stat("cls", "vitals.clsP75", "CLS P75", "plain"),

      entry("sessions-trend", "sessions-trend"),
      fixed(
        "traffic",
        createCatalogWidget(
          "timeseries",
          { metrics: ["traffic.pageViews", "traffic.uniqueUsers"] },
          { title: "访问量", view: "area" },
        ),
      ),
      entry("devices", "device-traffic"),
      entry("api-outcomes", "api-outcomes"),
      fixed(
        "errors",
        createCatalogWidget(
          "timeseries",
          { metrics: ["traffic.errors"] },
          { title: "错误数", view: "bar" },
        ),
      ),
      entry("vitals", "vitals-trend"),
      entry("browsers", "browser-share"),
      entry("countries", "country-traffic"),
      entry("top-pages", "top-pages"),
      fixed(
        "releases",
        createCatalogWidget(
          "breakdown",
          { metrics: ["issues.events"], dimension: "release" },
          { title: "各版本错误事件", view: "table" },
        ),
      ),
      fixed(
        "country-overview",
        createCatalogWidget(
          "metric-table",
          {
            metrics: ["traffic.sessions", "traffic.errorRate", "vitals.lcpP75"],
            dimension: "country",
          },
          { title: "各国概况", size: "full" },
        ),
      ),
      entry("issues", "top-issues"),
      entry("apis", "slow-apis"),
    ],
  };
}

/** Catalog metrics the default reads, so a template built from it can be gated on them. */
export function defaultDashboardMetrics(): string[] {
  const metrics = defaultDashboard().widgets.flatMap((widget) =>
    widget.data.source === "catalog" ? widget.data.metrics : [],
  );
  return [...new Set(metrics)];
}

// A notice that must survive the navigation to the dashboard it describes.
let pendingNotice = "";
export function setPendingNotice(message: string) {
  pendingNotice = message;
}
export function takePendingNotice() {
  const message = pendingNotice;
  pendingNotice = "";
  return message;
}

/** A name no personal dashboard uses, and never the built-in default's own name. */
export function uniqueDashboardName(base: string, existing: DashboardSummary[]) {
  const taken = new Set(existing.map((dashboard) => dashboard.name.toLowerCase()));
  taken.add(BUILT_IN_DASHBOARD_NAME.toLowerCase());
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 100; index++) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}
