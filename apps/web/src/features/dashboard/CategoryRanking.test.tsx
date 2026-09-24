// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlotData } from "./adapters";
import { CategoryRanking } from "./CategoryRanking";

vi.mock("@/lib/charts/useChartMotion", () => ({ useChartMotion: () => false }));
afterEach(cleanup);

function fixture(values: Array<number | null>): PlotData {
  return {
    kind: "categories",
    empty: false,
    note: "",
    rows: values.map((estimated, index) => ({ label: `group-${index}`, estimated })),
    series: [
      {
        key: "estimated",
        label: "事件次数",
        unit: "count",
        color: "var(--ds-chart-1)",
        ink: "var(--ds-chart-1)",
      },
    ],
    distribution: { dimension: "source", nonAdditive: false, limitReached: false, rowLimit: 100 },
  };
}

describe("category ranking", () => {
  it("shows direct values and shares, sorted bars scale against the maximum", () => {
    const data = fixture([20, 80]);
    const { getAllByRole, container } = render(<CategoryRanking data={data} title="来源" />);
    const rows = getAllByRole("listitem");
    expect(rows[0].textContent).toContain("group-1");
    expect(rows[0].textContent).toContain("80.0%");
    expect(rows[1].querySelector<HTMLElement>(".dashboard-ranking-fill")?.style.transform).toBe(
      "scaleX(0.25)",
    );
    expect(container.querySelector("svg.recharts-surface")).toBeNull();
    expect(data.rows[0].label).toBe("group-0");
  });
  it("uses all returned groups for shares and retains them in details", () => {
    const data = fixture(Array(12).fill(10));
    const { getByRole, getAllByRole, rerender } = render(
      <CategoryRanking data={data} title="来源" />,
    );
    expect(getAllByRole("listitem")).toHaveLength(10);
    expect(getAllByRole("listitem")[0].textContent).toContain("8.3%");
    expect(getByRole("list").getAttribute("tabindex")).toBe("0");
    rerender(<CategoryRanking data={data} title="来源" detailed />);
    expect(getAllByRole("listitem")).toHaveLength(12);
  });
  it("keeps zero distinct from unknown and suppresses incomplete shares", () => {
    const { getAllByRole } = render(<CategoryRanking data={fixture([10, 0, null])} title="来源" />);
    const rows = getAllByRole("listitem");
    expect(rows[1].querySelector(".dashboard-ranking-value")?.textContent).toBe("事件次数：0");
    expect(rows[2].querySelector(".dashboard-ranking-value")?.textContent).toBe("事件次数：—");
    expect(rows[0].querySelector(".dashboard-ranking-share")?.textContent).toBe("占比：—");
  });
  it("reuses bundled browser artwork and discloses overlapping/truncated groups", () => {
    const data = fixture([100]);
    data.rows[0].label = "Safari";
    data.distribution = {
      dimension: "browser",
      nonAdditive: true,
      limitReached: true,
      rowLimit: 100,
    };
    const { container, getByRole } = render(<CategoryRanking data={data} title="浏览器" />);
    expect(container.querySelector('[data-icon-source="devicon:safari"]')).not.toBeNull();
    expect(within(getByRole("listitem")).getByText("Safari")).toBeTruthy();
    expect(container.textContent).toContain("用户 / 会话可能跨分组重复");
    expect(container.textContent).toContain("已达 100 组查询上限");
  });
});
