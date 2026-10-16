// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PlotData } from "@/lib/charts/plotData";
import { PlotChart } from "./PlotChart";

beforeAll(() => {
  // jsdom has no layout, so a chart never learns its size. This observer reports a fixed one
  // as soon as it is asked to watch an element.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 600, height: 256 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const stacked: PlotData = {
  kind: "series",
  stacked: true,
  empty: false,
  note: "",
  intervalSeconds: 300,
  rangeMs: 900_000,
  series: [
    {
      key: "ok",
      label: "成功",
      unit: "count",
      color: "var(--ds-success)",
      ink: "var(--ds-success)",
    },
    {
      key: "bad",
      label: "失败",
      unit: "count",
      color: "var(--ds-danger)",
      ink: "var(--ds-danger)",
    },
  ],
  rows: [
    { label: "2026-10-11T10:00:00Z", ok: 8, bad: 2 },
    { label: "2026-10-11T10:05:00Z", ok: 9, bad: 1 },
    { label: "2026-10-11T10:10:00Z", ok: 7, bad: 3 },
  ],
};

describe("PlotChart", () => {
  // A stack's clip paths are named after its stack id and ids are document-wide, so two
  // stacked charts on one page (a drawer over its page) must not share one.
  it("keeps the clip paths of two stacked charts apart", async () => {
    render(
      <>
        <PlotChart data={stacked} view="stacked-bar" title="页面里的图" />
        <PlotChart data={stacked} view="stacked-bar" title="抽屉里的图" />
      </>,
    );
    const stackClipIds = () =>
      [...document.querySelectorAll("clipPath")]
        .map((clip) => clip.id)
        .filter((id) => id.startsWith("recharts-bar-stack-clip-path"));
    await waitFor(() => expect(stackClipIds().length).toBeGreaterThan(0));
    expect(new Set(stackClipIds()).size).toBe(stackClipIds().length);
  });

  it("reads a series on the right-hand axis from a second value axis", async () => {
    const withRate: PlotData = {
      ...stacked,
      stacked: false,
      series: [
        { ...stacked.series[0] },
        { key: "bad", label: "成功率", unit: "percent", color: "x", ink: "x", axis: "right" },
      ],
    };
    const { container } = render(<PlotChart data={withRate} view="line" title="双轴" />);
    await waitFor(() => expect(container.querySelectorAll(".recharts-yAxis").length).toBe(2));
  });
});
