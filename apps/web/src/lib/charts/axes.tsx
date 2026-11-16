import { TimeAxisTick, ValueAxisTick, type TickProps } from "./axisTicks";

// Shared axis anatomy for every Console chart with a value axis (user decision, 2026-11-11,
// replacing the in-plot labels tried earlier that day): value labels sit in their own column
// beside the plot, level with their gridline, and the top label carries the unit
// ("2,000 ms"). The column is as wide as its widest label, so the plot starts where the
// labels end and no line or area runs under them. Time labels stay below the baseline,
// centred under their bucket; only one too close to an edge to fit is aligned to that edge.

/**
 * Space between the plot and the labels of either axis. The two axes meet at the bottom-left
 * corner, where the baseline's "0" hangs half a line below the plot: any tighter and it sits
 * on top of the first time label.
 */
const AXIS_LABEL_GAP = 12;

/** Room above the top gridline for half of its label. Use it as the chart's `margin.top`. */
export const VALUE_AXIS_MARGIN_TOP = 8;

/**
 * Props for a value `YAxis`: labels in a column beside the plot, level with their gridlines,
 * the unit on the top label. Spread them onto the axis: `<YAxis {...valueAxis({ unit: "ms" })} domain=… />`.
 */
export function valueAxis({
  side = "left",
  unit,
  format,
}: {
  side?: "left" | "right";
  /** Written once, after the top label. Leave it out when the labels carry their own unit. */
  unit?: string;
  format?: (value: number) => string;
} = {}) {
  return {
    orientation: side,
    // Recharts measures labels through the formatter to decide which ticks fit.
    ...(format ? { tickFormatter: (value: number) => format(value) } : {}),
    // Recharts sizes the column from the rendered labels, which carry the class it looks for.
    width: "auto",
    axisLine: false,
    tickLine: false,
    tickMargin: AXIS_LABEL_GAP,
    tickSize: 0,
    tick: (props: TickProps) => (
      <ValueAxisTick {...props} side={side} unit={unit} format={format} />
    ),
  } as const;
}

/**
 * Props for a time `XAxis` below the plot: labels centred under their bucket, and one too
 * close to an edge aligned to it. Pass the chart's own formatter: Recharts also measures the
 * formatted labels to decide which ticks fit (`minTickGap`, `interval`), so without it every
 * label is measured as a raw ISO timestamp and most of them are dropped.
 */
export function timeAxis(format?: (value: unknown) => string) {
  return {
    axisLine: false,
    tickLine: false,
    tickMargin: AXIS_LABEL_GAP,
    ...(format ? { tickFormatter: (value: unknown) => format(value) } : {}),
    tick: (props: TickProps) => <TimeAxisTick {...props} format={format} />,
  } as const;
}
