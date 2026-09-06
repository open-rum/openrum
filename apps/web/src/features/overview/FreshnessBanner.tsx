import { CircleAlertIcon as AlertCircleIcon, Clock3Icon as ClockIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { OverviewResponse } from "@/lib/api/client";

export function FreshnessBanner({ freshness }: { freshness: OverviewResponse["freshness"] }) {
  if (freshness.latestReceivedAt === null) return null;
  const seconds = Math.round(freshness.ageSeconds ?? 0);
  if (!freshness.stale)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <ClockIcon aria-hidden="true" />
        <span>数据更新于 {seconds} 秒前</span>
        <Badge variant="secondary">实时</Badge>
      </div>
    );
  return (
    <Alert>
      <AlertCircleIcon />
      <AlertTitle>数据延迟 {formatAge(seconds)}</AlertTitle>
      <AlertDescription>
        当前指标仍可用于历史分析，但不要将其视为实时状态。请检查 Consumer lag 与 ClickHouse
        写入状态。
      </AlertDescription>
    </Alert>
  );
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时`;
}
