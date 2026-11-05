// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChartSwitch } from "./ChartSwitch";

describe("ChartSwitch", () => {
  it("marks the chosen option as the active boxed tab and reports a new choice", async () => {
    const onChange = vi.fn();
    render(
      <ChartSwitch
        label="切换趋势指标"
        options={[
          ["events", "事件"],
          ["users", "用户"],
        ]}
        value="events"
        onChange={onChange}
      />,
    );
    const group = screen.getByRole("group", { name: "切换趋势指标" });
    expect(group.className).toContain("tabs-box");
    const events = screen.getByRole("button", { name: "事件" });
    expect(events.getAttribute("aria-pressed")).toBe("true");
    expect(events.className).toContain("tab-active");
    expect(screen.getByRole("button", { name: "用户" }).className).not.toContain("tab-active");
    await userEvent.click(screen.getByRole("button", { name: "用户" }));
    expect(onChange).toHaveBeenCalledWith("users");
  });
});
