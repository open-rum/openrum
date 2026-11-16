// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PerformanceScoreRing } from "./PerformanceScoreRing";
import { overallPerformanceScore } from "./score";

afterEach(cleanup);

const metric = (p75: number) => ({ p75, samples: 100, sufficient: true });

/** Start angle and sweep of an arc path around (150, 150). */
function arc(path: string) {
  const [x0, y0, , , , , , x1, y1] = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const angle = (x: number, y: number) => (Math.atan2(y - 150, x - 150) * 180) / Math.PI;
  const from = angle(x0, y0);
  return { from, sweep: (angle(x1, y1) - from + 360) % 360 };
}

describe("PerformanceScoreRing", () => {
  it("cuts the ring by weight and fills each sector by its score", () => {
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
    const total = container.querySelector(".performance-ring-total")!;
    expect(total.textContent).toBe("68");
    expect(total.getAttribute("text-anchor")).toBe("middle");
    expect(total.getAttribute("dominant-baseline")).toBe("central");

    const weights = [30, 30, 15, 15, 10];
    let start = -90;
    [...container.querySelectorAll(".performance-ring-track")].forEach((track, index) => {
      const { from, sweep } = arc(track.getAttribute("d")!);
      const offset = ((from - (start + 4.5)) * Math.PI) / 180;
      expect(Math.atan2(Math.sin(offset), Math.cos(offset))).toBeCloseTo(0, 2);
      expect(sweep).toBeCloseTo((weights[index] / 100) * 360 - 9, 1);
      start += (weights[index] / 100) * 360;
    });
    expect(
      [...container.querySelectorAll(".performance-ring-score")].map((score) =>
        score.getAttribute("stroke-dasharray"),
      ),
    ).toEqual(["90 100", "90 100", "90 100", "0 100", "0 100"]);
    expect(
      [...container.querySelectorAll(".performance-ring-name")].map((label) => label.textContent),
    ).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);
    // Lighthouse colours: 90 is green, 0 is red; the total of 68 is amber.
    expect(
      [...container.querySelectorAll(".performance-ring-score")].map((score) =>
        score.getAttribute("stroke"),
      ),
    ).toEqual([
      "var(--color-success)",
      "var(--color-success)",
      "var(--color-success)",
      "var(--color-error)",
      "var(--color-error)",
    ]);
    expect(total.getAttribute("fill")).toBe("var(--color-warning)");
  });

  it("shows a sector's contribution to the total while it is pointed at or focused", () => {
    const scoring = overallPerformanceScore({
      route: "",
      pageViews: 100,
      lcp: metric(2500),
      inp: metric(200),
      cls: metric(0.1),
      fcp: metric(9000),
      ttfb: metric(9000),
    });
    const { container } = render(<PerformanceScoreRing scoring={scoring} />);
    const lcp = container.querySelector('[data-score-metric="LCP"]')!;
    fireEvent.pointerEnter(lcp);
    // 90 × 30 / 100 = 27 points.
    expect(container.querySelector(".performance-ring-contribution")!.textContent).toBe("+27");
    expect(container.querySelector(".performance-ring-caption")!.textContent).toBe(
      "LCP · 90 分 · 权重 30%",
    );
    expect(container.querySelector(".performance-ring-total")).toBeNull();
    expect(lcp.hasAttribute("data-active")).toBe(true);
    fireEvent.pointerLeave(lcp);
    expect(container.querySelector(".performance-ring-total")!.textContent).toBe("68");

    fireEvent.focus(container.querySelector('[data-score-metric="CLS"]')!);
    expect(container.querySelector(".performance-ring-contribution")!.textContent).toBe("+14");
  });

  it("keeps neutral tracks for missing values without fabricating scores", () => {
    const { container, getByRole } = render(
      <PerformanceScoreRing scoring={overallPerformanceScore(undefined)} />,
    );
    expect(getByRole("img", { name: "性能评分 暂无数据 / 100" })).toBeTruthy();
    expect(container.querySelectorAll(".performance-ring-track")).toHaveLength(5);
    expect(container.querySelectorAll(".performance-ring-score")).toHaveLength(0);
    expect(
      [...container.querySelectorAll(".performance-ring-track")].every(
        (track) => track.getAttribute("stroke") === "var(--color-base-300)",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("数据不完整或样本不足，仅供参考");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
