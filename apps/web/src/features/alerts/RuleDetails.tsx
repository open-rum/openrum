import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AlertNotification, AlertRule, NotificationChannel } from "@/lib/api/alerts";
import { environmentLabel } from "@/lib/projects/environments";
import { conditionText, formatDuration, ruleStatusLabels } from "./alertRules";
import { notificationTargets, recentRuleNotifications } from "./alertPresentation";
import { DeliveryLog } from "./DeliveryLog";
import { StatusBadge } from "./StatusBadge";

export function RuleDetails({
  rule,
  channels,
  notifications,
  canManage,
  channelsAvailable,
  onClose,
  onEdit,
  onHistory,
}: {
  rule: AlertRule;
  channels: NotificationChannel[];
  notifications: AlertNotification[];
  canManage: boolean;
  channelsAvailable: boolean;
  onClose: () => void;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const status = ruleStatusLabels[rule.lastStatus];
  const targets = notificationTargets(rule, channels, channelsAvailable);
  const history = recentRuleNotifications(notifications, rule.id);
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        style={{ width: "min(100vw, 860px)", maxWidth: "none" }}
        showCloseButton={false}
      >
        <SheetHeader className="pr-14">
          <SheetTitle className="break-words">{rule.name}</SheetTitle>
          <SheetDescription>
            规则详情 · {environmentLabel(rule.environment) || "全部环境"}
          </SheetDescription>
        </SheetHeader>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 right-4"
          aria-label="关闭规则详情"
          onClick={onClose}
        >
          <XIcon />
        </Button>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
          <div className="card card-border bg-base-200">
            <div className="card-body gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  tone={rule.enabled ? status.tone : "muted"}
                  label={rule.enabled ? status.label : "已停用"}
                />
                <span className="text-sm text-base-content/70">
                  {rule.lastEvaluatedAt
                    ? `最近评估：${new Date(rule.lastEvaluatedAt).toLocaleString("zh-CN")}`
                    : "等待首次评估"}
                </span>
              </div>
              <h2 className="text-lg font-semibold">{conditionText(rule)}</h2>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-base-content/70">通知去向</dt>
                  <dd className={`mt-1 ${targets.warning ? "text-warning" : ""}`}>
                    {targets.label}
                  </dd>
                </div>
                <div>
                  <dt className="text-base-content/70">重复通知间隔</dt>
                  <dd className="mt-1">{formatDuration(rule.cooldownMinutes)}</dd>
                </div>
              </dl>
              <p className="text-xs text-base-content/70">
                每分钟检查最近完成的固定统计窗口；此处是最近一次评估结果，不代表故障恢复状态。
              </p>
            </div>
          </div>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">最近触发</h2>
              <Button variant="ghost" size="sm" onClick={onHistory}>
                查看该规则的记录
              </Button>
            </div>
            <DeliveryLog notifications={history.slice(0, 5)} rules={[rule]} compact />
            <p className="text-xs text-base-content/70">
              从项目最近 100 条触发记录中选取，最多展示 5 条。
            </p>
          </section>
        </div>
        <SheetFooter className="flex-row justify-end border-t border-base-300">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {canManage ? <Button onClick={onEdit}>编辑规则</Button> : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
