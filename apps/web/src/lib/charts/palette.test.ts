import { describe, expect, it } from "vitest";
import { changeTone, formatChange, periodChange } from "./comparison";
import { categoryColor, OTHER_COLOR, seriesColor } from "./palette";

describe("chart palette", () => {
  it("assigns colours by rank and folds everything past nine into Other", () => {
    expect(categoryColor(0)).toBe("var(--ds-chart-1)");
    expect(categoryColor(8)).toBe("var(--ds-chart-9)");
    expect(categoryColor(9)).toBe(OTHER_COLOR);
    expect(seriesColor(3, "danger")).toBe("var(--ds-danger)");
  });
});

describe("period comparison", () => {
  it("uses points for ratios and percent otherwise, never inventing a change", () => {
    expect(periodChange(0.05, 0.02, true)).toBeCloseTo(3);
    expect(periodChange(150, 100, false)).toBe(50);
    expect(periodChange(150, 0, false)).toBeNull();
    expect(periodChange(null, 100, false)).toBeNull();
    expect(formatChange(3, true)).toBe("+3.00pp");
    expect(formatChange(null, false)).toBe("无对比");
  });

  it("tones a change by which way is better, and never tones neutral metrics", () => {
    expect(changeTone(10, false, "up")).toBe("positive");
    expect(changeTone(10, false, "down")).toBe("negative");
    expect(changeTone(10, false, "neutral")).toBe("neutral");
    expect(changeTone(0.04, false, "up")).toBe("neutral");
  });
});
