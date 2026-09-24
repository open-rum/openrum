import { useEffect, useRef, useState } from "react";

/** Width controls axis labels only, never the data query's point budget. */
export function useChartWidth<T extends HTMLElement = HTMLDivElement>(active = true) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return { ref, width };
}
