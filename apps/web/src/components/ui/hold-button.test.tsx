// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "./hold-button";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HoldButton", () => {
  it("confirms only after the full hold", () => {
    const onHold = vi.fn();
    render(<HoldButton onHold={onHold}>长按删除项目</HoldButton>);
    const button = screen.getByRole("button", { name: /长按删除项目/ });
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("按住 2 秒确认")).toBeTruthy();

    fireEvent.keyDown(button, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.keyUp(button, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(onHold).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(2200));
    expect(onHold).toHaveBeenCalledOnce();
    expect(button.getAttribute("data-phase")).toBe("done");
  });

  it("ignores input while disabled", () => {
    const onHold = vi.fn();
    render(
      <HoldButton disabled onHold={onHold}>
        长按删除项目
      </HoldButton>,
    );
    const button = screen.getByRole("button", { name: /长按删除项目/ });
    fireEvent.keyDown(button, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(onHold).not.toHaveBeenCalled();
  });
});
