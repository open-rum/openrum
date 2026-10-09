import { describe, expect, it } from "vitest";
import { metricCatalogSchema } from "@/lib/api/metricsQuery";
import { validateCatalogWidget } from "./catalogRules";
import { widgetSchema } from "./model";
// Both files are owned by the backend. The golden catalog is what the Go catalog publishes;
// the case matrix is what the Go validator is tested against. If the Console and the API
// disagree on any case, a module could look valid in the editor and then fail to save.
import golden from "../../../../../internal/catalog/testdata/catalog.golden.json";
import sharedCases from "../../../../../internal/metadata/testdata/dashboard_widget_cases.json";

const catalog = metricCatalogSchema.parse(golden);
const cases = sharedCases as Array<{ name: string; valid: boolean; widget: unknown }>;

describe("catalog rules match the backend", () => {
  it("parses the golden catalog the backend publishes", () => {
    expect(catalog.metrics.length).toBeGreaterThan(20);
    expect(catalog.metrics.find((metric) => metric.id === "vitals.lcpP75")?.thresholds).toEqual({
      good: 2500,
      poor: 4000,
    });
  });

  it.each(cases.map((current) => [current.name, current] as const))("%s", (_, current) => {
    const parsed = widgetSchema.safeParse(current.widget);
    const accepted = parsed.success && validateCatalogWidget(parsed.data, catalog) === null;
    expect(accepted).toBe(current.valid);
  });
});
