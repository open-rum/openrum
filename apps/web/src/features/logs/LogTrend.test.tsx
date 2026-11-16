// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LogPage } from "@/lib/api/logs";
import { LogTrend } from "./LogTrend";

vi.mock("@/lib/charts/useChartMotion", () => ({ useChartMotion: () => false }));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 800, height: 112 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const from = "2026-11-13T05:00:00Z";
const to = "2026-11-13T05:02:00Z";
const data: LogPage = {
  items: [],
  total: 21,
  nextCursor: "",
  intervalSeconds: 120,
  trend: [{ bucket: from, trace: 1, debug: 2, info: 3, warn: 4, error: 5, fatal: 6 }],
};

describe("LogTrend legend", () => {
  it("keeps the chart expanded and theme colors separate from series variables", () => {
    render(<LogTrend data={data} from={from} to={to} onRange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "日志上报量" })).toBeTruthy();
    expect(screen.getByText("每 2 分钟")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /趋势/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    const legend = screen.getByRole("list", { name: "日志级别图例" });
    expect(
      within(legend)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
    const styles = document.querySelector("style")?.textContent ?? "";
    expect(styles).toContain("var(--color-error)");
    expect(styles).not.toMatch(/--color-(error|info)\s*:/);
  });

  it("toggles series with pointer and keyboard without changing the analysis range", async () => {
    const onRange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<LogTrend data={data} from={from} to={to} onRange={onRange} />);
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar")).toHaveLength(6));
    const info = screen.getByRole("button", { name: "INFO", pressed: true });
    await user.click(info);
    expect(info.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar")).toHaveLength(5));
    await user.keyboard("{Enter}");
    expect(info.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar")).toHaveLength(6));
    expect(onRange).not.toHaveBeenCalled();
  });

  it("highlights a series on hover or focus and restores the others on leave", async () => {
    const { container } = render(<LogTrend data={data} from={from} to={to} onRange={vi.fn()} />);
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar")).toHaveLength(6));
    const info = screen.getByRole("button", { name: "INFO" });
    const opacity = (level: string) =>
      container
        .querySelector(`path[fill="var(--color-logs_${level})"]`)
        ?.getAttribute("fill-opacity");
    fireEvent.mouseEnter(info);
    expect(opacity("info")).toBe("1");
    expect(opacity("error")).toBe("0.25");
    fireEvent.mouseLeave(info);
    expect(opacity("error")).toBe("1");
    fireEvent.focus(info);
    expect(opacity("error")).toBe("0.25");
    fireEvent.blur(info);
    expect(opacity("error")).toBe("1");
  });
});
