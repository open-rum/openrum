// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PerformanceScoreRing } from "./PerformanceScoreRing";
import { overallPerformanceScore } from "./score";

afterEach(cleanup);

describe("PerformanceScoreRing", () => {
  it.each([0, 7, 31, 100, null])("uses the same center for score %s", (score) => {
    const { container } = render(
      <PerformanceScoreRing scoring={{ ...overallPerformanceScore(undefined), score }} />,
    );
    const total = container.querySelector(".performance-score-total")!;
    expect(total.textContent).toBe(score === null ? "—" : String(score));
    expect(total.getAttribute("x")).toBe("120");
    expect(total.getAttribute("y")).toBe("106");
    expect(total.getAttribute("text-anchor")).toBe("middle");
    expect(total.getAttribute("dominant-baseline")).toBe("central");
  });

  it("labels weighted sectors outside the ring and centers the actual total", () => {
    const metric = (p75: number) => ({ p75, samples: 100, sufficient: true });
    const scoring = overallPerformanceScore({
      route: "",
      pageViews: 100,
      lcp: metric(2500),
      inp: metric(200),
      cls: metric(0.1),
      fcp: metric(9000),
      ttfb: metric(9000),
    });
    const { container, getByRole } = render(<PerformanceScoreRing scoring={scoring} />);
    expect(getByRole("img", { name: "性能评分 68 / 100" })).toBeTruthy();
    const total = container.querySelector(".performance-score-total")!;
    expect(total.textContent).toBe("68");
    expect(total.getAttribute("text-anchor")).toBe("middle");
    expect(total.getAttribute("dominant-baseline")).toBe("central");
    expect(container.querySelectorAll(".performance-score-track")).toHaveLength(5);
    expect(
      [...container.querySelectorAll(".performance-score-arc")].map((arc) =>
        arc.getAttribute("stroke-dasharray"),
      ),
    ).toEqual(["90 100", "0 100", "90 100", "90 100", "0 100"]);
    const labels = [...container.querySelectorAll(".performance-score-label")];
    expect(labels.map((label) => label.textContent)).toEqual(["LCP", "FCP", "INP", "CLS", "TTFB"]);
    // Verify actual SVG arc endpoints, not only the weight metadata.
    let startAngle = -90;
    const angles = [108, 54, 108, 54, 36];
    const sectors = [...container.querySelectorAll("[data-score-metric]")];
    expect(sectors.map((sector) => Number(sector.getAttribute("data-score-weight")))).toEqual([
      30, 15, 30, 15, 10,
    ]);
    for (const [index, sector] of sectors.entries()) {
      const coordinates = sector
        .querySelector("path")!
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      const start = (Math.atan2(coordinates[1] - 106, coordinates[0] - 120) * 180) / Math.PI;
      const end = (Math.atan2(coordinates[8] - 106, coordinates[7] - 120) * 180) / Math.PI;
      const span = (end - start + 360) % 360;
      expect(span).toBeCloseTo(angles[index] - 3, 1);
      const startDifference = ((start - (startAngle + 1.5)) * Math.PI) / 180;
      expect(Math.atan2(Math.sin(startDifference), Math.cos(startDifference))).toBeCloseTo(0, 3);
      startAngle += angles[index];
    }
    expect(startAngle).toBe(270);
    for (const label of labels) {
      expect(
        Math.hypot(Number(label.getAttribute("x")) - 120, Number(label.getAttribute("y")) - 106),
      ).toBeGreaterThan(90);
    }
  });

  it("keeps labels and neutral tracks for missing values without fabricating scores", () => {
    const { container, getByRole } = render(
      <PerformanceScoreRing scoring={overallPerformanceScore(undefined)} />,
    );
    expect(getByRole("img", { name: "性能评分 暂无数据 / 100" })).toBeTruthy();
    expect(container.querySelectorAll(".performance-score-track")).toHaveLength(5);
    expect(container.querySelectorAll(".performance-score-arc")).toHaveLength(0);
    expect(container.querySelectorAll(".performance-score-label")).toHaveLength(5);
    expect(container.textContent).toContain("数据不完整或样本不足，仅供参考");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
