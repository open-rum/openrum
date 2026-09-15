import { describe, expect, it } from "vitest";
import { describeComparison } from "./comparison";
import { formatDetailedMetric, type ScalarData } from "./adapters";
import { createWidget, type Widget } from "./model";

const scalar: ScalarData = {
  kind: "scalar",
  value: 120,
  unit: "count",
  detail: "100 个样本",
  comparison: { change: 20, unit: "percent", previous: 100 },
};
const widget = (metric: string) =>
  createWidget("stat", { data: { source: "overview", metrics: [metric] } as Widget["data"] });

describe("dashboard comparison", () => {
  it.each(["pageViews", "uniqueUsers"])("uses increasing %s as positive", (metric) => {
    expect(describeComparison(scalar, widget(metric))).toMatchObject({
      tone: "positive",
      direction: "up",
      label: "+20.0%",
    });
    expect(
      describeComparison(
        { ...scalar, comparison: { ...scalar.comparison!, change: -20 } },
        widget(metric),
      ),
    ).toMatchObject({ tone: "negative", direction: "down" });
  });
  it.each(["errorRate", "apiFailureRate", "lcp", "inp", "cls"])(
    "uses increasing %s as negative",
    (metric) => {
      expect(describeComparison(scalar, widget(metric))).toMatchObject({
        tone: "negative",
        direction: "up",
      });
      expect(
        describeComparison(
          { ...scalar, comparison: { ...scalar.comparison!, change: -20 } },
          widget(metric),
        ),
      ).toMatchObject({ tone: "positive", direction: "down" });
    },
  );
  it.each([null, NaN, Infinity])("keeps missing/nonfinite %s neutral", (change) => {
    expect(
      describeComparison(
        { ...scalar, comparison: { ...scalar.comparison!, change } },
        widget("pageViews"),
      ),
    ).toMatchObject({ tone: "neutral", label: "无对比" });
  });
  it.each([0, 0.001, -0.001])("keeps display-rounded zero %s neutral", (change) => {
    expect(
      describeComparison(
        { ...scalar, comparison: { ...scalar.comparison!, change } },
        widget("pageViews"),
      ),
    ).toMatchObject({ tone: "neutral", direction: "flat", label: "0.0%" });
  });
  it("does not fabricate changes for missing data or insufficient samples", () => {
    expect(describeComparison({ ...scalar, value: null }, widget("pageViews"))?.tone).toBe(
      "neutral",
    );
    expect(
      describeComparison(
        { ...scalar, comparison: { ...scalar.comparison!, previous: null } },
        widget("pageViews"),
      )?.tone,
    ).toBe("neutral");
    expect(describeComparison({ ...scalar, insufficient: true }, widget("inp"))).toMatchObject({
      tone: "neutral",
      label: "样本不足",
    });
    expect(
      describeComparison({ ...scalar, comparison: undefined }, widget("pageViews")),
    ).toBeNull();
  });
  it("preserves percentage-point units and exact detail units", () => {
    expect(
      describeComparison(
        { ...scalar, comparison: { change: 0.5, previous: 0, unit: "points" } },
        widget("errorRate"),
      ),
    ).toMatchObject({ tone: "negative", label: "+0.50pp" });
    expect(formatDetailedMetric(123456, "count")).toBe("123,456");
    expect(formatDetailedMetric(2499, "ms")).toBe("2,499 ms");
    expect(formatDetailedMetric(null, "percent")).toBe("—");
  });
});
