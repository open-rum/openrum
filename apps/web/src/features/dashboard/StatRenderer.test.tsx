// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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
  it("places comparison and a short explanation below the value without sampling metadata", () => {
    const { container } = render(<StatRenderer widget={createWidget("stat")} data={data} />);
    const children = [...container.firstElementChild!.children];
    expect(children[0].tagName).toBe("STRONG");
    expect(children[1].textContent).toBe("+20.0%较上一周期");
    expect(children[2].textContent).toBe("页面浏览次数");
    expect(container.textContent).not.toContain("采集样本");
  });
  it("keeps the metric explanation when there is no previous-period comparison", () => {
    const widget = createWidget("stat", {
      data: { source: "events", metrics: ["uniqueUsers"], dimension: "country" },
    });
    const { container } = render(
      <StatRenderer widget={widget} data={{ ...data, comparison: undefined }} />,
    );
    expect(container.textContent).toContain("触发这些事件的独立用户");
    expect(container.querySelector(".dashboard-comparison")).toBeNull();
  });
  it("does not describe insufficient performance samples as a comparable trend", () => {
    const widget = createWidget("stat", { data: { source: "overview", metrics: ["inp"] } });
    const { container } = render(
      <StatRenderer widget={widget} data={{ ...data, unit: "ms", insufficient: true }} />,
    );
    expect(container.textContent).toContain("样本不足仅供参考");
    expect(container.textContent).toContain("交互响应耗时 · P75");
    expect(container.textContent).not.toContain("较上一周期");
  });
});
