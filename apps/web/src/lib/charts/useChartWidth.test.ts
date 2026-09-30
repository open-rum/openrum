// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHART_RESIZE_DEBOUNCE_MS, observeElementWidth } from "./useChartWidth";

let deliver: (width: number) => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        deliver = (width) =>
          callback([{ contentRect: { width } } as ResizeObserverEntry], this as never);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("observeElementWidth", () => {
  it("reports the first width at once and coalesces a resize animation into one update", () => {
    const widths: number[] = [];
    const stop = observeElementWidth(document.createElement("div"), (width) => widths.push(width));
    deliver(800);
    expect(widths).toEqual([800]);
    // One entry per animation frame while the sidebar width transitions.
    for (const width of [790, 760, 720, 690, 660, 644]) {
      deliver(width);
      vi.advanceTimersByTime(16);
    }
    expect(widths).toEqual([800]);
    vi.advanceTimersByTime(CHART_RESIZE_DEBOUNCE_MS);
    expect(widths).toEqual([800, 644]);
    stop();
  });

  it("drops a pending update once stopped", () => {
    const widths: number[] = [];
    const stop = observeElementWidth(document.createElement("div"), (width) => widths.push(width));
    deliver(800);
    deliver(600);
    stop();
    vi.advanceTimersByTime(CHART_RESIZE_DEBOUNCE_MS * 2);
    expect(widths).toEqual([800]);
  });
});
