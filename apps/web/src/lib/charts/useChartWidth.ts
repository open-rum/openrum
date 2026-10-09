import { useEffect, useRef, useState } from "react";

/**
 * How long a chart waits for its container to stop resizing before it re-lays out.
 * Longer than the sidebar's 180ms width transition, so collapsing or expanding the
 * sidebar costs one re-render per chart instead of one per animation frame.
 */
export const CHART_RESIZE_DEBOUNCE_MS = 200;

/**
 * Reports an element's width: the first measurement at once, later ones only after the
 * size has been stable for CHART_RESIZE_DEBOUNCE_MS. Returns the cleanup function.
 */
export function observeElementWidth(element: Element, onWidth: (width: number) => void) {
  let timer = 0;
  let first = true;
  const observer = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (first) {
      first = false;
      onWidth(width);
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onWidth(width), CHART_RESIZE_DEBOUNCE_MS);
  });
  observer.observe(element);
  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
  };
}

/** Width controls axis labels only, never the data query's point budget. */
export function useChartWidth<T extends HTMLElement = HTMLDivElement>(active = true) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    return observeElementWidth(element, setWidth);
  }, [active]);
  return { ref, width };
}
