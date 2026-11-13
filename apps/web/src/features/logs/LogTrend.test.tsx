// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartConfig } from "@/components/ui/chart";
import { LogTrend } from "./LogTrend";
import type { LogPage } from "@/lib/api/logs";
vi.mock("@/lib/charts/useChartWidth", () => ({
  useChartWidth: () => ({ ref: undefined, width: 800 }),
}));
vi.mock("@/components/ui/chart", async (original) => {
  const chart = await original<typeof import("@/components/ui/chart")>();
  return {
    ...chart,
    ChartContainer: ({ children, config }: { children: React.ReactNode; config: ChartConfig }) => (
      <div>
        <chart.ChartStyle id="test-log-chart" config={config} />
        {children}
      </div>
    ),
  };
});
afterEach(cleanup);
const data: LogPage = {
  total: 2,
  items: [],
  nextCursor: "",
  intervalSeconds: 3600,
  trend: [
    { bucket: "2026-11-11T10:00:00Z", trace: 0, debug: 0, info: 0, warn: 0, error: 2, fatal: 0 },
  ],
};
describe("Logs trend controls", () => {
  it("keeps the reporting chart visible with a descriptive legend and no extra controls", () => {
    render(
      <LogTrend
        data={data}
        from="2026-11-11T10:15:00Z"
        to="2026-11-11T10:45:00Z"
        onRange={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "日志上报量" })).toBeTruthy();
    expect(screen.getByText("每 1 小时")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /趋势/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    const legend = screen.getByRole("list", { name: "日志级别图例" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
    expect(within(legend).queryByRole("button")).toBeNull();
    const styles = document.querySelector("style")?.textContent ?? "";
    expect(styles).toContain("var(--color-error)");
    expect(styles).not.toMatch(/--color-(error|info)\s*:/);
  });
});
