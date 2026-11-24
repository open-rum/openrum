import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetric, type ScalarData } from "./adapters";
import { describeComparison, toneBadge } from "./comparison";
import type { Widget } from "./model";

/**
 * Previous-period change. `corner` (Stat cards) is only the badge, pinned to the card's
 * top-right, with "较上一周期" and the previous value in a hover/focus tooltip; `inline`
 * (details) keeps the explanatory text beside the badge.
 */
export function ModuleComparison({
  widget,
  data: scalar,
  variant = "inline",
}: {
  widget: Widget;
  data: ScalarData;
  variant?: "inline" | "corner";
}) {
  const comparison = describeComparison(scalar, widget);
  if (!comparison) return null;
  const previous = formatMetric(scalar.comparison?.previous ?? null, scalar.unit);
  const description = scalar.insufficient
    ? "样本不足，暂不判定周期变化"
    : `相比上一周期 ${comparison.label}；上一周期 ${previous}`;
  const badge = (
    <span
      className={cn(
        "dashboard-comparison",
        comparison.label === "无对比"
          ? "text-xs leading-5 text-base-content/70"
          : ["badge badge-sm badge-soft", toneBadge[comparison.tone]],
      )}
      aria-label={description}
      tabIndex={variant === "corner" ? 0 : undefined}
    >
      {comparison.direction === "up" ? (
        <TrendingUpIcon className="size-3" aria-hidden="true" />
      ) : comparison.direction === "down" ? (
        <TrendingDownIcon className="size-3" aria-hidden="true" />
      ) : null}
      {comparison.label}
    </span>
  );

  if (variant === "corner") {
    return (
      <div className="dashboard-comparison-corner">
        <div
          className="tooltip tooltip-bottom tooltip-left"
          data-tip={
            scalar.insufficient
              ? "样本不足，暂不判定周期变化"
              : `较上一周期 ${comparison.label} · 上一周期 ${previous}`
          }
        >
          {badge}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-comparison-row flex flex-wrap items-center gap-2">
      <span title={description}>{badge}</span>
      {comparison.label !== "无对比" ? (
        <span className="text-xs text-base-content/70">
          {scalar.insufficient ? "仅供参考" : "较上一周期"}
        </span>
      ) : null}
    </div>
  );
}
