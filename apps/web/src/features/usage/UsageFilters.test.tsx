// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageFilters } from "./UsageFilters";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("shared usage controls", () => {
  it("changes the range without replacing the event type and marks the selected duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    const onChange = vi.fn();
    render(
      <UsageFilters
        range={{
          from: new Date("2026-10-29T00:00:00Z"),
          to: new Date("2026-11-05T00:00:00Z"),
          eventType: "error",
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("combobox", { name: "事件类型" }).textContent).toBe("错误");
    expect(screen.getByRole("radio", { name: "最近 7 天" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "最近 30 天" }));
    expect(onChange).toHaveBeenCalledWith({
      from: "2026-10-06T00:00:00.000Z",
      to: "2026-11-05T00:00:00.000Z",
    });
  });
});
