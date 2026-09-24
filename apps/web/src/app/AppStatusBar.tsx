import type { ReactNode } from "react";
import { Clock3Icon } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Badge } from "@/components/ui/badge";

export function AppStatusBar({
  context,
  navigationToggle,
  dataDelayed = false,
}: {
  context?: ReactNode;
  navigationToggle: ReactNode;
  dataDelayed?: boolean;
}) {
  return (
    <header className="app-status-bar" role="region" aria-label="应用状态栏">
      {navigationToggle}
      {context}
      <div className="app-status-bar__actions" aria-label="全局操作">
        {dataDelayed ? (
          <Badge variant="outline" title="最新接收事件尚未完成查询入库" role="status">
            <Clock3Icon aria-hidden="true" /> 数据延迟
          </Badge>
        ) : null}
        <ThemeToggle compact />
      </div>
    </header>
  );
}
