// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api/projects";
import { AnalysisContextControls, useAnalysisContextState } from "./AnalysisContextBar";

const projectId = "11111111-1111-4111-8111-111111111111";
const project = { id: projectId } as Project;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.removeItem(`openrum-analysis-context:${projectId}`);
  window.history.replaceState({}, "", "/");
});

describe("analysis time filter", () => {
  it("opens with the grouped preset list and applies a relative range", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    renderFilter(update);

    await user.click(screen.getByRole("button", { name: /选择时间范围，当前为/ }));

    const presets = screen.getByRole("group", { name: "快捷时间范围" });
    expect(within(presets).getAllByRole("button")).toHaveLength(15);
    expect(screen.getByRole("button", { name: "自定义" })).toBeTruthy();
    expect(within(presets).getByRole("button", { name: "上周的今天" })).toBeTruthy();
    expect(within(presets).getByRole("button", { name: "本月" })).toBeTruthy();
    expect(document.querySelector('[data-slot="calendar"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: "最近 5 分钟" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith({ timePreset: "5m" });
    expect(screen.queryByRole("group", { name: "快捷时间范围" })).toBeNull();
  });

  it("only shows the calendar after choosing custom and can return to presets", async () => {
    const user = userEvent.setup();
    renderFilter(vi.fn());

    await user.click(screen.getByRole("button", { name: /选择时间范围，当前为/ }));
    await user.click(screen.getByRole("button", { name: "自定义" }));

    expect(screen.getByText("自定义时间范围")).toBeTruthy();
    // The calendar is a separate module that loads when the custom range opens.
    await waitFor(() => expect(document.querySelector('[data-slot="calendar"]')).toBeTruthy());
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "返回快捷时间范围" }));
    expect(screen.getByRole("group", { name: "快捷时间范围" })).toBeTruthy();
    expect(document.querySelector('[data-slot="calendar"]')).toBeNull();
  });

  it("resolves yesterday as the previous local calendar day", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", `/projects/${projectId}/overview`);
    render(<ContextProbe />);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    await user.click(screen.getByRole("button", { name: /选择时间范围，当前为/ }));
    await user.click(screen.getByRole("button", { name: "昨天" }));

    const search = new URL(window.location.href).searchParams;
    expect(search.get("timePreset")).toBe("yesterday");
    expect(search.get("from")).toBe(yesterday.toISOString());
    expect(search.get("to")).toBe(today.toISOString());
  });

  it("keeps a selected rolling window live and replaces its URL bounds each minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:10.000Z"));
    window.history.replaceState(
      {},
      "",
      `/projects/${projectId}/overview?from=2026-09-30T03%3A00%3A00.000Z&to=2026-09-30T09%3A00%3A00.000Z&timePreset=6h`,
    );
    render(<ContextProbe />);

    expect(screen.getByTestId("range-label").textContent).toBe("最近 6 小时");
    expect(screen.getByTestId("range-to").textContent).toBe("2026-09-30T10:00:00.000Z");
    expect(new URL(window.location.href).searchParams.get("to")).toBe("2026-09-30T10:00:00.000Z");

    act(() => vi.advanceTimersByTime(50_100));
    expect(screen.getByTestId("range-label").textContent).toBe("最近 6 小时");
    expect(screen.getByTestId("range-to").textContent).toBe("2026-09-30T10:01:00.000Z");
    expect(new URL(window.location.href).searchParams.get("to")).toBe("2026-09-30T10:01:00.000Z");
  });

  it("keeps an explicit custom window fixed as time passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:10.000Z"));
    window.history.replaceState(
      {},
      "",
      `/projects/${projectId}/overview?from=2026-09-30T04%3A00%3A00.000Z&to=2026-09-30T10%3A00%3A00.000Z&timePreset=6h`,
    );
    render(<ContextProbe />);

    expect(screen.getByTestId("range-label").textContent).toBe("最近 6 小时");
    fireEvent.click(screen.getByRole("button", { name: "Apply custom range" }));
    expect(screen.getByTestId("range-label").textContent).not.toBe("最近 6 小时");
    act(() => vi.advanceTimersByTime(3 * 60_000));
    expect(screen.getByTestId("range-to").textContent).toBe("2026-09-30T10:00:00.000Z");
    expect(new URL(window.location.href).searchParams.has("timePreset")).toBe(false);
  });
});

function ContextProbe() {
  const context = useAnalysisContextState(project, true);
  if (!context) return null;
  return (
    <>
      <span data-testid="range-to">{context.to.toISOString()}</span>
      <span data-testid="range-label">
        <AnalysisContextControls context={context} />
      </span>
      <button
        type="button"
        onClick={() =>
          context.update({
            from: new Date("2026-09-30T04:00:00.000Z"),
            to: new Date("2026-09-30T10:00:00.000Z"),
          })
        }
      >
        Apply custom range
      </button>
    </>
  );
}

function renderFilter(update: (patch: { from?: Date; to?: Date; environment?: string }) => void) {
  return render(
    <AnalysisContextControls
      context={{
        projectId,
        from: new Date("2026-09-11T09:28:00.000Z"),
        to: new Date("2026-09-12T09:28:00.000Z"),
        environment: "production",
        update,
      }}
    />,
  );
}
