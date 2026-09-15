import type { ScalarData } from "./adapters";
import type { Widget } from "./model";

export function describeComparison(data: ScalarData, widget: Widget) {
  const comparison = data.comparison;
  const neutral = { tone: "neutral", direction: "flat" } as const;
  if (data.insufficient) return { ...neutral, label: "样本不足" };
  if (!comparison) return null;
  const change = comparison.change;
  if (
    change === null ||
    !Number.isFinite(change) ||
    data.value === null ||
    comparison.previous === null
  )
    return { ...neutral, label: "无对比" };
  // Match the displayed precision: a rounded zero must not look like a change.
  const rounded = Number(change.toFixed(comparison.unit === "points" ? 2 : 1));
  const label = `${rounded > 0 ? "+" : ""}${rounded.toFixed(comparison.unit === "points" ? 2 : 1)}${comparison.unit === "points" ? "pp" : "%"}`;
  if (rounded === 0) return { ...neutral, label };
  const lowerIsBetter =
    widget.data.source === "overview" &&
    ["errorRate", "apiFailureRate", "lcp", "inp", "cls"].includes(widget.data.metrics[0]);
  return {
    label,
    direction: rounded > 0 ? ("up" as const) : ("down" as const),
    tone: (lowerIsBetter ? rounded < 0 : rounded > 0)
      ? ("positive" as const)
      : ("negative" as const),
  };
}
