// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChartSwitch } from "./ChartSwitch";

describe("ChartSwitch", () => {
  it("is the segmented control: the chosen option is checked and a new choice is reported", async () => {
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
    const group = screen.getByRole("radiogroup", { name: "切换趋势指标" });
    expect(group.querySelector('[data-slot="toggle-group-thumb"]')).not.toBeNull();
    expect(screen.getByRole("radio", { name: "事件" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "用户" }).getAttribute("aria-checked")).toBe("false");
    await userEvent.click(screen.getByRole("radio", { name: "用户" }));
    expect(onChange).toHaveBeenCalledWith("users");
    // Clicking the chosen option again never clears the chart's choice.
    onChange.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: "事件" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
