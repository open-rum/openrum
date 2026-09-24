import { describe, expect, it } from "vitest";
import {
  chartTicks,
  continuousRows,
  DASHBOARD_MAX_POINTS,
  intervalLabel,
  intervalSeconds,
} from "./chartDensity";
import { moduleQueryOptions } from "./queries";
import { createWidget } from "./model";

describe("adaptive dashboard charts", () => {
  it("uses the same 30-point query default for Overview and Events", () => {
    expect(DASHBOARD_MAX_POINTS).toBe(30);
    const filters = {
      projectId: "11111111-1111-4111-8111-111111111111",
      from: new Date("2026-09-16"),
      to: new Date("2026-09-23"),
    };
    for (const type of ["stat", "timeseries", "breakdown"] as const) {
      const widget = createWidget(type);
      expect(moduleQueryOptions(widget, filters, "user").queryKey).toEqual(
        moduleQueryOptions(widget, filters, "user", 30).queryKey,
      );
    }
  });
  it("fills gaps with null without changing backend values or edge buckets", () => {
    const first = { label: "2026-09-23T00:00:00Z", uv: 12, p75: 1200 };
    const last = { label: "2026-09-23T02:00:00Z", uv: 12, p75: 900 };
    const rows = continuousRows(
      [first, last],
      "2026-09-23T00:08:00Z",
      "2026-09-23T02:08:00Z",
      3600,
      ["uv", "p75"],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(first);
    expect(rows[1].uv).toBeNull();
    expect(rows[1].p75).toBeNull();
    expect(rows[2]).toBe(last);
    expect(continuousRows([], first.label, last.label, 3600, ["uv"])).toEqual([]);
  });
  it("limits labels to 2–6 while keeping both ends and reports the actual interval", () => {
    const rows = Array.from({ length: 85 }, (_, i) => ({ label: String(i) }));
    expect(chartTicks(rows, 320)).toEqual(["0", "84"]);
    expect(chartTicks(rows, 1600)).toHaveLength(6);
    expect(chartTicks(rows, 1600).at(-1)).toBe("84");
    expect(intervalSeconds("120 MINUTE")).toBe(7200);
    expect(intervalSeconds("1 HOUR")).toBe(3600);
    expect(intervalLabel(7200)).toBe("2 小时");
  });
  it("separates density cache keys, but reuses them across views and card sizes", () => {
    const widget = createWidget("timeseries");
    const filters = {
      projectId: "11111111-1111-4111-8111-111111111111",
      from: new Date("2026-09-16"),
      to: new Date("2026-09-23"),
    };
    const original = moduleQueryOptions(widget, filters, "user", 96).queryKey;
    expect(
      moduleQueryOptions({ ...widget, view: "bar", size: "full" }, filters, "user", 96).queryKey,
    ).toEqual(original);
    expect(moduleQueryOptions(widget, filters, "user", 24).queryKey).not.toEqual(original);
  });
});
