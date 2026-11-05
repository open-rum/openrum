import { cloneElement, isValidElement, useEffect, useState, type ComponentProps } from "react";
import { DefaultTooltipContent, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { ChartTooltip as SharedChartTooltip } from "@openrum/ui/chart";

export {
  BAR_RADIUS_TOP,
  BAR_RADIUS_COMPACT,
  BAR_RADIUS_TRAILING,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltipContent,
  type ChartConfig,
} from "@openrum/ui/chart";

/**
 * Recharts slides the tooltip from wherever it last stood, so the first hover glided in from
 * the chart's left edge. The Console places it at the cursor when it appears and keeps the
 * slide only while it moves between points.
 */
export function ChartTooltip({ content, ...props }: ComponentProps<typeof SharedChartTooltip>) {
  const [showing, setShowing] = useState(false);
  return (
    <SharedChartTooltip
      isAnimationActive={showing}
      {...props}
      content={<TooltipActivity render={content} onActiveChange={setShowing} />}
    />
  );
}

type TooltipContent = ComponentProps<typeof SharedChartTooltip>["content"];

/** Reports whether the tooltip is showing, then renders the caller's content unchanged. */
function TooltipActivity({
  render,
  onActiveChange,
  ...props
}: Partial<TooltipContentProps<ValueType, NameType>> & {
  // Not `content`: Recharts passes its own `content` prop into the element it clones.
  render: TooltipContent;
  onActiveChange: (active: boolean) => void;
}) {
  // Recharts fills in the tooltip props when it clones this element.
  const tooltip = props as TooltipContentProps<ValueType, NameType>;
  // Over a gap Recharts keeps the tooltip active but hidden, so it is showing only with a payload.
  const active = Boolean(tooltip.active && tooltip.payload?.length);
  useEffect(() => {
    if (!active) {
      onActiveChange(false);
      return undefined;
    }
    // Turn the slide on only after the browser has drawn the tooltip in place; switched on in
    // the same frame, the browser would still animate it in from the chart's corner.
    let next = 0;
    const first = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => onActiveChange(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(next);
    };
  }, [active, onActiveChange]);
  if (isValidElement(render)) return cloneElement(render, tooltip);
  if (typeof render === "function") return render(tooltip);
  return <DefaultTooltipContent {...tooltip} />;
}
