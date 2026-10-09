import { describe, expect, it } from "vitest";
import { ecommerceDashboard, ecommerceMetrics } from "./ecommerce";
import { MAX_WIDGETS, readWidget, type StoredWidget } from "./model";
import { dashboardTemplates } from "./templates";

const widgets = () => ecommerceDashboard().widgets as StoredWidget[];

describe("e-commerce dashboard template", () => {
  it("is one of the templates offered for a new dashboard", () => {
    const template = dashboardTemplates.find((entry) => entry.id === "ecommerce");
    expect(template?.name).toBe("电商经营概览");
    expect(template?.metrics).toEqual(ecommerceMetrics());
    expect(template?.build().widgets).toHaveLength(widgets().length);
  });

  it("builds only valid modules, within the module limit and with unique ids", () => {
    const list = widgets();
    expect(list.length).toBeLessThanOrEqual(MAX_WIDGETS);
    expect(list.every((record) => readWidget(record))).toBe(true);
    expect(new Set(list.map((record) => record.id)).size).toBe(list.length);
  });

  it("fills whole rows: stat cards in fours, thirds in threes, halves in pairs", () => {
    const sizes = widgets().map((record) => record.size);
    let row = 0;
    const widthOf = { compact: 3, third: 4, half: 6, full: 12 } as const;
    for (const size of sizes) {
      row += widthOf[size as keyof typeof widthOf];
      expect(row).toBeLessThanOrEqual(12);
      if (row === 12) row = 0;
    }
    expect(row).toBe(0);
  });

  it("reads revenue as good news when it rises, and reports revenue from purchase amounts", () => {
    const revenue = readWidget(widgets()[0])!;
    expect(revenue.title).toBe("收入");
    expect(revenue.data).toMatchObject({
      metrics: ["measurement.sum"],
      measurement: "amount",
      filters: { eventName: "purchase" },
      direction: "up",
    });
    expect(ecommerceMetrics()).toEqual(
      expect.arrayContaining([
        "measurement.sum",
        "measurement.avg",
        "behavior.events",
        "traffic.sessions",
      ]),
    );
  });
});
