import { describe, expect, it } from "vitest";
import { metricCatalogSchema } from "@/lib/api/metricsQuery";
import golden from "../../../../../internal/catalog/testdata/catalog.golden.json";
import { validateCatalogWidget } from "./catalogRules";
import { defaultDashboard, isBuiltInDashboard, uniqueDashboardName } from "./builtIn";
import { MAX_WIDGETS, widgetSchema } from "./model";

const catalog = metricCatalogSchema.parse(golden);
const summary = (name: string) => ({
  id: crypto.randomUUID(),
  name,
  position: 0,
  revision: 1,
  widgetCount: 1,
  updatedAt: "2026-09-28T00:00:00Z",
});

describe("built-in default dashboard", () => {
  it("is a valid, stable layout the backend would accept", () => {
    const first = defaultDashboard();
    expect(first.widgets.length).toBeLessThanOrEqual(MAX_WIDGETS);
    expect(new Set(first.widgets.map((widget) => widget.id)).size).toBe(first.widgets.length);
    for (const widget of first.widgets) {
      expect(widgetSchema.safeParse(widget).success).toBe(true);
      expect(validateCatalogWidget(widget, catalog)).toBeNull();
    }
    // Ids are fixed, so re-rendering the default never remounts its cards.
    expect(defaultDashboard().widgets.map((widget) => widget.id)).toEqual(
      first.widgets.map((widget) => widget.id),
    );
    // Headline numbers fill whole rows of the four-column grid.
    const stats = first.widgets.filter((widget) => widget.type === "stat");
    expect(stats.length % 4).toBe(0);
  });

  it("shows every kind of module the dashboard can draw", () => {
    const widgets = defaultDashboard().widgets;
    const kinds = new Set(widgets.map((widget) => `${widget.type}:${widget.view}`));
    for (const kind of [
      "stat:number",
      "timeseries:line",
      "timeseries:area",
      "timeseries:bar",
      "timeseries:stacked-area",
      "timeseries:stacked-bar",
      "breakdown:bar",
      "breakdown:table",
      "breakdown:donut",
      "ranked-table:table",
      "metric-table:table",
      "top-issues:table",
    ])
      expect(kinds, kind).toContain(kind);
    const appearances = new Set(widgets.map((widget) => widget.statAppearance).filter(Boolean));
    expect([...appearances].sort()).toEqual(["bar-right", "line-right", "plain"]);
    expect(widgets.some((widget) => widget.data.source === "catalog" && widget.data.compare)).toBe(
      true,
    );
    // Half-width modules come in pairs between full-width ones, so no row is left ragged.
    let halves = 0;
    for (const widget of widgets) {
      if (widget.size === "half") halves++;
      if (widget.size === "full") {
        expect(halves % 2).toBe(0);
        halves = 0;
      }
    }
    expect(halves % 2).toBe(0);
  });

  it("never names a personal dashboard after the built-in one", () => {
    expect(isBuiltInDashboard("default")).toBe(true);
    expect(uniqueDashboardName("我的仪表盘", [])).toBe("我的仪表盘");
    expect(uniqueDashboardName("我的仪表盘", [summary("我的仪表盘")])).toBe("我的仪表盘 2");
    expect(uniqueDashboardName("默认仪表盘", [])).toBe("默认仪表盘 2");
  });
});
