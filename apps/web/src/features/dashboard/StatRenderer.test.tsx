// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatRenderer } from "./ModuleRenderers";
import { createWidget } from "./model";
import type { ScalarData } from "./adapters";

afterEach(cleanup);

const data: ScalarData = {
  kind: "scalar",
  value: 120,
  unit: "count",
  detail: "100 个采集样本",
  comparison: { change: 20, unit: "percent", previous: 100 },
};

describe("stat card hierarchy", () => {
  it.each(["line-right", "bar-right"] as const)(
    "does not fabricate %s when there is no trend data",
    (appearance) => {
      const { container, getByRole } = render(
        <StatRenderer widget={createWidget("stat", { statAppearance: appearance })} data={data} />,
      );
      expect(container.querySelector(`[data-stat-appearance="${appearance}"]`)).not.toBeNull();
      expect(getByRole("status").textContent).toBe("暂无趋势数据");
      expect(container.querySelector('[data-slot="chart"]')).toBeNull();
    },
  );
  it("shows the value alone and pins the comparison to the top-right corner", () => {
    const { container } = render(<StatRenderer widget={createWidget("stat")} data={data} />);
    const summary = container.firstElementChild!;
    expect([...summary.children].map((child) => child.tagName)).toEqual(["STRONG"]);
    const corner = container.querySelector(".dashboard-comparison-corner")!;
    expect(corner.textContent).toBe("+20.0%");
    expect(container.textContent).not.toContain("较上一周期");
    expect(container.textContent).not.toContain("页面浏览次数");
    expect(container.textContent).not.toContain("采集样本");
  });
  it("explains the comparison and the previous value on hover or focus", async () => {
    // Radix positions the tooltip with ResizeObserver, which jsdom lacks.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    render(<StatRenderer widget={createWidget("stat")} data={data} />);
    const badge = screen.getByLabelText("相比上一周期 +20.0%；上一周期 100");
    act(() => {
      fireEvent.focus(badge);
    });
    expect((await screen.findAllByText("较上一周期 +20.0%")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("上一周期 100").length).toBeGreaterThan(0);
  });
  it("shows only the value when there is no previous-period comparison", () => {
    const widget = createWidget("stat", {
      data: { source: "events", metrics: ["uniqueUsers"], dimension: "country" },
    });
    const { container } = render(
      <StatRenderer widget={widget} data={{ ...data, comparison: undefined }} />,
    );
    expect(container.textContent).toBe("120");
    expect(container.querySelector(".dashboard-comparison")).toBeNull();
  });
  it("does not describe insufficient performance samples as a comparable trend", () => {
    const widget = createWidget("stat", { data: { source: "overview", metrics: ["inp"] } });
    const { container } = render(
      <StatRenderer widget={widget} data={{ ...data, unit: "ms", insufficient: true }} />,
    );
    expect(container.querySelector(".dashboard-comparison-corner")?.textContent).toBe("样本不足");
    expect(container.textContent).not.toContain("交互响应耗时 · P75");
    expect(container.textContent).not.toContain("较上一周期");
  });
});
