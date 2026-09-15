import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMetric, type ScalarData } from "./adapters";
import { describeComparison } from "./comparison";
import type { Widget } from "./model";

export function ModuleComparison({ widget, data: scalar }: { widget: Widget; data: ScalarData }) {
  const comparison = describeComparison(scalar, widget);
  if (!comparison) return null;
  const description = scalar.insufficient
    ? "样本不足，暂不判定周期变化"
    : `相比上一周期 ${comparison.label}；上一周期 ${formatMetric(scalar.comparison?.previous ?? null, scalar.unit)}`;
  return (
    <div className="dashboard-comparison-row flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className="dashboard-comparison"
        data-tone={comparison.tone}
        aria-label={description}
        title={description}
      >
        {comparison.direction === "up" ? (
          <TrendingUpIcon aria-hidden="true" />
        ) : comparison.direction === "down" ? (
          <TrendingDownIcon aria-hidden="true" />
        ) : null}
        {comparison.label}
      </Badge>
      {comparison.label !== "无对比" ? (
        <span className="text-xs text-muted-foreground">
          {scalar.insufficient ? "仅供参考" : "较上一周期"}
        </span>
      ) : null}
    </div>
  );
}
