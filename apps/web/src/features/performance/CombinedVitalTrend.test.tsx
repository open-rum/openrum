// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CombinedVitalTrend } from "./CombinedVitalTrend";
import { PerformanceOverview, VitalThresholdBar } from "./PerformanceOverview";

beforeAll(() => {
  // jsdom has no layout, so a chart never learns its size. This observer reports a fixed one
  // as soon as it is asked to watch an element.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 640, height: 240 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const metric = (p75: number) => ({ p50: p75, p75, p95: p75, samples: 100, sufficient: true });
const trend = ["2026-11-01T00:00:00Z", "2026-11-01T01:00:00Z", "2026-11-01T02:00:00Z"].map(
  (bucket, index) => ({
    bucket,
    lcp: metric(2400 + index * 100),
    inp: metric(180 + index * 10),
    cls: metric(0.08),
    fcp: metric(1600),
    ttfb: metric(700),
  }),
);

describe("CombinedVitalTrend", () => {
  it("switches the same buckets between line, area and bar views", async () => {
    const { container } = render(<CombinedVitalTrend trend={trend} percentile="p75" />);
    const switcher = screen.getByRole("group", { name: "图表类型" });
    expect(switcher.className).toContain("tabs-box");
    expect(screen.getByRole("button", { name: "折线" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(container.querySelectorAll(".recharts-line")).toHaveLength(3));

    await userEvent.click(screen.getByRole("button", { name: "面积" }));
    expect(screen.getByRole("img", { name: /面积图/ })).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".recharts-area")).toHaveLength(3));
    const fills = [...container.querySelectorAll(".recharts-area-area")].map((area) =>
      area.getAttribute("fill"),
    );
    // Every area has its own gradient, not only the first series.
    expect(new Set(fills).size).toBe(3);
    for (const fill of fills) expect(fill).toMatch(/^url\(#.+-(lcp|inp|cls)\)$/);

    await userEvent.click(screen.getByRole("button", { name: "柱状" }));
    expect(screen.getByRole("img", { name: /柱状图/ })).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar")).toHaveLength(3));
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(0);
  });
});

describe("VitalThresholdBar", () => {
  it("draws good, needs-improvement and poor bands up to 1.5× the poor threshold", () => {
    const { container } = render(<VitalThresholdBar name="LCP" value={3000} />);
    const [good, needs] = container.querySelectorAll<HTMLElement>(".performance-threshold > span");
    // Track ends at 6000 ms: good is 2500, needs-improvement 1500.
    expect(parseFloat(good.style.width)).toBeCloseTo(41.67, 1);
    expect(parseFloat(needs.style.width)).toBeCloseTo(25, 1);
    expect(
      parseFloat(container.querySelector<HTMLElement>("[data-threshold-marker]")!.style.left),
    ).toBe(50);
    expect(container.textContent).toContain("≤ 2.5s");
    expect(container.textContent).toContain("> 4s");
  });

  it("pins slow values to the end and omits the marker without a value", () => {
    const slow = render(<VitalThresholdBar name="INP" value={5000} />);
    expect(
      parseFloat(slow.container.querySelector<HTMLElement>("[data-threshold-marker]")!.style.left),
    ).toBe(99);
    expect(slow.container.textContent).toContain("≤ 200ms");
    cleanup();
    const missing = render(<VitalThresholdBar name="CLS" value={null} />);
    expect(missing.container.querySelector("[data-threshold-marker]")).toBeNull();
    expect(missing.container.textContent).toContain("> 0.25");
  });
});

describe("CombinedVitalTrend percentile", () => {
  it("leaves the percentile choice to the page header", () => {
    render(<CombinedVitalTrend trend={trend} percentile="p95" />);
    expect(screen.queryByRole("combobox", { name: "统计分位数" })).toBeNull();
    expect(screen.getByRole("img", { name: /P95/ })).toBeTruthy();
  });
});

describe("PerformanceOverview vitals", () => {
  // LCP is good at P75 (2000ms) but poor at P95 (6000ms).
  const summary = {
    route: "*",
    pageViews: 100,
    lcp: { p50: 1500, p75: 2000, p95: 6000, samples: 100, sufficient: true },
    inp: metric(150),
    cls: metric(0.05),
    fcp: metric(1200),
    ttfb: metric(500),
  };
  const lcpStat = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>(".stat")].find((stat) =>
      stat.textContent?.startsWith("LCP"),
    )!;

  it("moves the threshold marker with the page percentile but keeps the P75 rating", () => {
    const { container } = render(
      <PerformanceOverview summary={summary} trend={trend} percentile="p95" />,
    );
    const stat = lcpStat(container);
    expect(stat.querySelector(".stat-value")?.textContent).toBe("6000ms");
    // 6000ms on a 0–6000ms track pins to the end, not at P75's 2000ms.
    const marker = stat.querySelector<HTMLElement>("[data-threshold-marker]")!;
    expect(parseFloat(marker.style.left)).toBe(99);
    expect(stat.querySelector(".badge")?.textContent).toBe("P75 良好");
    expect(stat.querySelector(".stat-desc")?.textContent).toContain("P75");
    expect(screen.getByText("按权重合成 · 固定按 P75")).toBeTruthy();
  });

  it("drops the P75 prefix on the badge when P75 is the page percentile", () => {
    const { container } = render(
      <PerformanceOverview summary={summary} trend={trend} percentile="p75" />,
    );
    const stat = lcpStat(container);
    expect(stat.querySelector(".badge")?.textContent).toBe("良好");
    const marker = stat.querySelector<HTMLElement>("[data-threshold-marker]")!;
    expect(parseFloat(marker.style.left)).toBeCloseTo((2000 / 6000) * 100, 0);
  });
});
