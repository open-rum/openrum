import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMetric, type ScalarData } from "./adapters";
import { describeComparison } from "./comparison";
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
    <Badge
      variant="outline"
      className="dashboard-comparison"
      data-tone={comparison.tone}
      aria-label={description}
      tabIndex={variant === "corner" ? 0 : undefined}
    >
      {comparison.direction === "up" ? (
        <TrendingUpIcon aria-hidden="true" />
      ) : comparison.direction === "down" ? (
        <TrendingDownIcon aria-hidden="true" />
      ) : null}
      {comparison.label}
    </Badge>
  );

  if (variant === "corner") {
    return (
      <div className="dashboard-comparison-corner">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              {scalar.insufficient ? (
                "样本不足，暂不判定周期变化"
              ) : (
                <span className="grid gap-0.5">
                  <span>较上一周期 {comparison.label}</span>
                  <span className="tabular-nums opacity-80">上一周期 {previous}</span>
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <div className="dashboard-comparison-row flex flex-wrap items-center gap-2">
      <span title={description}>{badge}</span>
      {comparison.label !== "无对比" ? (
        <span className="text-xs text-muted-foreground">
          {scalar.insufficient ? "仅供参考" : "较上一周期"}
        </span>
      ) : null}
    </div>
  );
}
