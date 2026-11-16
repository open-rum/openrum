import type { ReactNode } from "react";

// The tick labels behind `valueAxis` and `timeAxis` in `axes.tsx`.

export type TickProps = {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
  index?: number;
  visibleTicksCount?: number;
};

const toNumber = (value: number | string | undefined) => Number(value ?? 0);

function defaultFormat(value: unknown) {
  return typeof value === "number" ? value.toLocaleString("zh-CN") : String(value ?? "");
}

/**
 * The narrowest a value axis's label column gets: room for five characters ("1,000",
 * "750ms", "1.50s"). A longer label, such as one carrying a unit, still widens its own chart.
 */
export const VALUE_LABEL_MIN_WIDTH = 38;

export function ValueAxisTick({
  x,
  y,
  payload,
  index = 0,
  visibleTicksCount = 0,
  side,
  unit,
  format,
}: TickProps & {
  side: "left" | "right";
  unit?: string;
  format?: (value: number) => ReactNode;
}) {
  const value = payload?.value;
  const text = format && typeof value === "number" ? format(value) : defaultFormat(value);
  const top = Boolean(unit) && visibleTicksCount > 0 && index === visibleTicksCount - 1;
  const left = side === "left";
  return (
    <g>
      {/* Recharts sizes the column from the widest element of this class. This empty box
          makes that at least VALUE_LABEL_MIN_WIDTH, so charts whose figures differ in length
          ("4", "100") still start their plots at the same place. */}
      <rect
        className="recharts-cartesian-axis-tick-value"
        x={toNumber(x) - (left ? VALUE_LABEL_MIN_WIDTH : 0)}
        y={toNumber(y)}
        width={VALUE_LABEL_MIN_WIDTH}
        height={1}
        fill="none"
      />
      <text
        x={toNumber(x)}
        y={toNumber(y)}
        dy="0.32em"
        // Against the plot: a left axis ends its labels there, a right axis starts them there.
        textAnchor={left ? "end" : "start"}
        className="recharts-cartesian-axis-tick-value fill-muted-foreground tabular-nums"
      >
        {text}
        {top ? ` ${unit}` : null}
      </text>
    </g>
  );
}

/** Half a typical date label: closer to a plot edge than this, a centred label is cut off. */
const EDGE_ROOM = 28;

export function TimeAxisTick({
  x,
  y,
  width,
  payload,
  format,
}: TickProps & { width?: number | string; format?: (value: unknown) => ReactNode }) {
  const value = payload?.value;
  const position = toNumber(x);
  const plotWidth = toNumber(width);
  // A label stays centred under its bucket. Only one that sits too close to an edge to fit
  // is aligned to that edge instead. Behind a left value axis the first label has that
  // column's width to spread into, so it stays centred.
  const anchor =
    position < EDGE_ROOM
      ? "start"
      : plotWidth > 0 && position > plotWidth - EDGE_ROOM
        ? "end"
        : "middle";
  return (
    // Recharts wraps custom ticks outside the chart container's axis-text selector, so the
    // muted colour is set here.
    <text
      x={toNumber(x)}
      y={toNumber(y)}
      dy="0.71em"
      textAnchor={anchor}
      className="fill-muted-foreground"
    >
      {format ? format(value) : String(value ?? "")}
    </text>
  );
}
