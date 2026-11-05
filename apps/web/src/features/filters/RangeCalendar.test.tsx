// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RangeCalendar from "./RangeCalendar";

afterEach(cleanup);

const today = new Date(2026, 10, 3, 14, 0);

function dayButton(container: HTMLElement, isoDay: string) {
  return container.querySelector<HTMLButtonElement>(`[data-day="${isoDay}"] button`);
}

describe("RangeCalendar", () => {
  it("disables days after today and hides the neighbouring months' days", () => {
    const { container } = render(
      <RangeCalendar
        selected={{ from: new Date(2026, 9, 29), to: new Date(2026, 9, 30) }}
        onSelect={() => {}}
        defaultMonth={new Date(2026, 9, 1)}
        today={today}
      />,
    );
    expect(dayButton(container, "2026-11-03")?.disabled).toBe(false);
    expect(dayButton(container, "2026-11-04")?.disabled).toBe(true);
    // October's last days appear once, in October; November leaves those cells empty.
    expect(container.querySelectorAll('[data-day="2026-10-30"] button')).toHaveLength(1);
    expect(container.querySelectorAll(".rdp-selected button")).toHaveLength(2);
  });

  it("previews the range up to the pointer once a start is picked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RangeCalendar
        selected={{ from: new Date(2026, 9, 20), to: undefined }}
        onSelect={onSelect}
        defaultMonth={new Date(2026, 9, 1)}
        today={today}
      />,
    );
    fireEvent.mouseEnter(dayButton(container, "2026-10-24")!);
    const previewed = [...container.querySelectorAll(".rdp-range_preview")].map((cell) =>
      cell.getAttribute("data-day"),
    );
    expect(previewed).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
    fireEvent.mouseLeave(container.querySelector('[data-slot="calendar"]')!);
    expect(container.querySelectorAll(".rdp-range_preview")).toHaveLength(0);
  });

  it("starts a new range when a finished one is clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RangeCalendar
        selected={{ from: new Date(2026, 9, 29), to: new Date(2026, 9, 30) }}
        onSelect={onSelect}
        defaultMonth={new Date(2026, 9, 1)}
        today={today}
      />,
    );
    fireEvent.click(dayButton(container, "2026-10-20")!);
    expect(onSelect).toHaveBeenCalledWith({ from: new Date(2026, 9, 20), to: undefined });
  });
});
