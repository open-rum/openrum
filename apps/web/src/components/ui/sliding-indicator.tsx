import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The pill behind the selected option of a segmented control (single-select ToggleGroup,
 * default Tabs). It follows whichever child matches `activeSelector`, so it works for
 * controlled and uncontrolled roots, and slides between options instead of jumping.
 */
export function SlidingIndicator({
  containerRef,
  activeSelector,
  className,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  activeSelector: string;
  className?: string;
}) {
  const indicatorRef = React.useRef<HTMLSpanElement>(null);
  const [box, setBox] = React.useState<{ left: number; width: number } | null>(null);
  // The first placement must not animate in from the left edge.
  const [ready, setReady] = React.useState(false);

  React.useLayoutEffect(() => {
    // A child's layout effect runs before its parent's ref is attached, so the container
    // ref can still be empty on the first pass; the indicator's own parent is the same node.
    const container = containerRef.current ?? indicatorRef.current?.parentElement;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLElement>(activeSelector);
      setBox(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();
    const frame = requestAnimationFrame(() => setReady(true));
    const mutations = new MutationObserver(measure);
    mutations.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-checked", "aria-selected"],
      childList: true,
    });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    resize?.observe(container);
    for (const child of Array.from(container.children)) resize?.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
    };
  }, [containerRef, activeSelector]);

  // Rendered even before the first measurement so the effect above can find its container.
  return (
    <span
      ref={indicatorRef}
      aria-hidden="true"
      data-slot="sliding-indicator"
      className={cn(
        "pointer-events-none absolute inset-y-[3px] left-0 z-0 rounded-full bg-background shadow-sm dark:bg-input",
        ready && "transition-[transform,width] duration-200 ease-out motion-reduce:transition-none",
        !box && "hidden",
        className,
      )}
      style={box ? { width: box.width, transform: `translateX(${box.left}px)` } : undefined}
    />
  );
}
