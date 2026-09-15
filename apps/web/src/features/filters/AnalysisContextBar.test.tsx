// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisContextControls } from "./AnalysisContextBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("analysis time filter", () => {
  it("opens with the expanded preset grid and applies a relative range", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    renderFilter(update);

    await user.click(screen.getByRole("button", { name: /选择时间范围，当前为/ }));

    const presets = screen.getByRole("group", { name: "快捷时间范围" });
    expect(within(presets).getAllByRole("button")).toHaveLength(16);
    expect(within(presets).getByRole("button", { name: "上周的今天" })).toBeTruthy();
    expect(within(presets).getByRole("button", { name: "本月" })).toBeTruthy();
    expect(document.querySelector('[data-slot="calendar"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: "最近 5 分钟" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const patch = update.mock.calls[0]?.[0] as { from: Date; to: Date };
    expect(patch.to.getTime() - patch.from.getTime()).toBe(5 * 60 * 1000);
    expect(screen.queryByRole("group", { name: "快捷时间范围" })).toBeNull();
  });

  it("only shows the calendar after choosing custom and can return to presets", async () => {
    const user = userEvent.setup();
    renderFilter(vi.fn());

    await user.click(screen.getByRole("button", { name: /选择时间范围，当前为/ }));
    await user.click(screen.getByRole("button", { name: "自定义" }));

    expect(screen.getByText("自定义时间范围")).toBeTruthy();
    expect(document.querySelector('[data-slot="calendar"]')).toBeTruthy();
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "返回快捷时间范围" }));
    expect(screen.getByRole("group", { name: "快捷时间范围" })).toBeTruthy();
    expect(document.querySelector('[data-slot="calendar"]')).toBeNull();
  });

  it("resolves yesterday as the previous local calendar day", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    renderFilter(update);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    await user.click(screen.getByRole("button", { name: /选择时间范围，当前为/ }));
    await user.click(screen.getByRole("button", { name: "昨天" }));

    const patch = update.mock.calls[0]?.[0] as { from: Date; to: Date };
    expect(patch.from).toEqual(yesterday);
    expect(patch.to).toEqual(today);
  });
});

function renderFilter(
  update: (patch: { from?: Date; to?: Date; environment?: string }) => void,
) {
  return render(
    <AnalysisContextControls
      context={{
        projectId: "11111111-1111-4111-8111-111111111111",
        from: new Date("2026-09-11T09:28:00.000Z"),
        to: new Date("2026-09-12T09:28:00.000Z"),
        environment: "production",
        update,
      }}
    />,
  );
}
