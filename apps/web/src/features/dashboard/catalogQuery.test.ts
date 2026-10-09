import { describe, expect, it } from "vitest";
import { metricCatalogSchema, metricsQueryString } from "@/lib/api/metricsQuery";
import golden from "../../../../../internal/catalog/testdata/catalog.golden.json";
import { coerceCatalogWidget, validateCatalogWidget } from "./catalogRules";
import { createCatalogWidget, widgetSchema } from "./model";
import { library, libraryDomains } from "./library";
import { catalogQueryParams } from "./queries";
import { dashboardTemplates } from "./templates";

const catalog = metricCatalogSchema.parse(golden);
const filters = {
  projectId: "p1",
  from: new Date("2026-09-02T10:00:00Z"),
  to: new Date("2026-09-02T11:00:00Z"),
  environment: "production",
};

describe("catalog module queries", () => {
  it("gives a stat its comparison so appearance changes never issue a new query", () => {
    const stat = createCatalogWidget("stat", { metrics: ["traffic.sessions"] });
    const params = catalogQueryParams(stat, filters, 30);
    expect(params).toMatchObject({ shape: "series", compare: true, maxPoints: 30 });
    const withTrend = catalogQueryParams({ ...stat, statAppearance: "area-right" }, filters, 30);
    expect(metricsQueryString(withTrend)).toBe(metricsQueryString(params));
  });

  it("maps views and types onto shapes", () => {
    const stacked = createCatalogWidget(
      "timeseries",
      { metrics: ["api.clientErrorRate", "api.serverErrorRate"] },
      { view: "stacked-area" },
    );
    expect(catalogQueryParams(stacked, filters, 30)).toMatchObject({
      shape: "series",
      stack: "metrics",
    });
    const split = createCatalogWidget(
      "timeseries",
      { metrics: ["traffic.pageViews"], dimension: "device", compare: "previous" },
      { view: "stacked-bar" },
    );
    expect(catalogQueryParams(split, filters, 30)).toMatchObject({
      shape: "seriesByDimension",
      stack: "dimension",
      compare: false,
    });
    const ranked = createCatalogWidget("ranked-table", {
      metrics: ["traffic.pageViews"],
      dimension: "route",
    });
    expect(catalogQueryParams(ranked, filters, 30)).toMatchObject({
      shape: "table",
      compare: true,
      sparkline: true,
    });
    // The retired world map view reads as ranked bars and asks for no special limit.
    const legacy = widgetSchema.parse({
      ...createCatalogWidget("breakdown", {
        metrics: ["traffic.pageViews"],
        dimension: "country",
      }),
      view: "map",
    });
    expect(legacy.view).toBe("bar");
    expect(catalogQueryParams(legacy, filters, 30).topN).toBeUndefined();
  });

  it("draws pinned events as ordered lines without a group limit", () => {
    const payments = createCatalogWidget(
      "timeseries",
      {
        metrics: ["behavior.events"],
        dimension: "eventName",
        groups: ["pay_start", "pay_success", "pay_failed"],
        topN: 5,
      },
      { title: "支付事件", view: "line" },
    );
    const coerced = coerceCatalogWidget(payments, catalog).widget;
    expect(validateCatalogWidget(coerced, catalog)).toBeNull();
    const params = catalogQueryParams(coerced, filters, 30);
    expect(params).toMatchObject({ shape: "seriesByDimension", topN: undefined });
    const search = new URLSearchParams(metricsQueryString(params));
    expect(search.getAll("group")).toEqual(["pay_start", "pay_success", "pay_failed"]);
    expect(search.has("topN")).toBe(false);

    // Removing the split drops the pinned events rather than leaving a module that cannot save.
    const unsplit = coerceCatalogWidget(
      { ...coerced, data: { ...coerced.data, dimension: undefined } } as typeof coerced,
      catalog,
    ).widget;
    expect(unsplit.data.source === "catalog" && unsplit.data.groups).toBeFalsy();
    expect(validateCatalogWidget(unsplit, catalog)).toBeNull();
  });

  it("forwards link filters only where the source can apply them", () => {
    const linked = { ...filters, release: "1.2.0", route: "/checkout" };
    const traffic = createCatalogWidget("stat", { metrics: ["traffic.pageViews"] });
    expect(catalogQueryParams(traffic, linked, 30).filters).toMatchObject({
      release: "1.2.0",
      route: "/checkout",
    });
    const byRoute = createCatalogWidget("ranked-table", {
      metrics: ["traffic.pageViews"],
      dimension: "route",
    });
    expect(catalogQueryParams(byRoute, linked, 30).filters?.route).toBeUndefined();
    const revenue = createCatalogWidget("stat", {
      metrics: ["measurement.sum"],
      measurement: "amount",
    });
    expect(catalogQueryParams(revenue, linked, 30).filters).toEqual({});
  });

  it("offers only library modules and templates the backend would accept", () => {
    for (const entry of library) {
      const widget = widgetSchema.parse(entry.create());
      expect(validateCatalogWidget(widget, catalog), entry.id).toBeNull();
      // An entry's declared requirements are exactly the catalog metrics it reads.
      const reads = widget.data.source === "catalog" ? widget.data.metrics : [];
      expect([...reads].sort(), entry.id).toEqual([...entry.requires].sort());
    }
    for (const template of dashboardTemplates) {
      for (const record of template.build().widgets) {
        const parsed = widgetSchema.safeParse(record);
        expect(parsed.success, `${template.id}/${record.id}`).toBe(true);
        if (parsed.success)
          expect(
            validateCatalogWidget(parsed.data, catalog),
            `${template.id}/${record.id}`,
          ).toBeNull();
      }
    }
  });

  it("keeps every module once, in one domain, with dimensions inside modules", () => {
    const names = library.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    const domains = new Set(libraryDomains.map((domain) => domain.id));
    for (const entry of library) expect(domains.has(entry.domain), entry.id).toBe(true);
    expect(library.filter((entry) => entry.recommended).length).toBeGreaterThanOrEqual(6);
    // Country, device, browser and source are choices inside modules, not cards of their own.
    for (const retired of ["国家圆环分布", "设备圆环分布", "浏览器圆环分布", "来源圆环分布"])
      expect(names).not.toContain(retired);
  });
});
