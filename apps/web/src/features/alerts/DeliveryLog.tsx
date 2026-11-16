import { useState } from "react";
import { ArrowRightIcon, BellRingIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AlertNotification, AlertRule, DeliveryState } from "@/lib/api/alerts";
import { ChannelKindIcon } from "@/features/settings/channels/ChannelKindIcon";
import { environmentLabel } from "@/lib/projects/environments";
import {
  comparatorLabels,
  deliveryErrorText,
  deliveryStateLabels,
  formatMetricValue,
  metricDefinitions,
} from "./alertRules";
import { StatusBadge } from "./StatusBadge";

export function DeliveryLog({
  notifications,
  rules,
  onShowRules,
  initialRuleId = "all",
  initialDelivery = "all",
  compact = false,
}: {
  notifications: AlertNotification[];
  rules: AlertRule[];
  onShowRules?: () => void;
  initialRuleId?: string;
  initialDelivery?: "all" | DeliveryState;
  compact?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | DeliveryState>(initialDelivery);
  const [ruleFilter, setRuleFilter] = useState(initialRuleId);
  const visible = notifications
    .filter(
      (item) =>
        (filter === "all" || item.delivery === filter) &&
        (ruleFilter === "all" || item.ruleId === ruleFilter),
    )
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  if (!notifications.length)
    return (
      <div className="card card-border bg-base-100">
        <div className="card-body items-center py-12 text-center">
          <BellRingIcon className="mb-2 size-7 text-base-content/70" aria-hidden="true" />
          <h2 className="card-title">
            {rules.length ? "尚未记录到规则触发" : "先创建一条告警规则"}
          </h2>
          <p className="max-w-lg text-sm text-base-content/70">
            {rules.length
              ? "启用规则后，达到阈值的窗口会记录在这里，包括冷却期跳过和仅在控制台记录的情况。"
              : "规则达到阈值后，这里会显示观测值、通知去向和每个渠道的投递结果。"}
          </p>
          {onShowRules ? (
            <Button variant="outline" className="mt-3" onClick={onShowRules}>
              查看规则
              <ArrowRightIcon />
            </Button>
          ) : null}
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {!compact ? (
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="select select-sm w-auto"
            aria-label="送达状态"
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
          >
            <option value="all">全部送达状态</option>
            {Object.entries(deliveryStateLabels).map(([value, state]) => (
              <option key={value} value={value}>
                {state.label}
              </option>
            ))}
          </select>
          <select
            className="select select-sm max-w-full sm:w-60"
            aria-label="记录所属规则"
            value={ruleFilter}
            onChange={(event) => setRuleFilter(event.target.value)}
          >
            <option value="all">全部规则</option>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-base-content/70" role="status">
            {visible.length} 条记录
          </span>
          <p className="w-full text-xs text-base-content/70">
            最近 {notifications.length} 条触发记录，最多加载 100
            条；包含未发送通知的触发，不是全量历史。
          </p>
        </div>
      ) : null}
      <div className="card card-border overflow-hidden bg-base-100">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>触发时间 / 规则</TableHead>
              <TableHead>观测值</TableHead>
              <TableHead>通知结果</TableHead>
              <TableHead>
                <span className="sr-only">诊断入口</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => {
              const state = deliveryStateLabels[item.delivery];
              return (
                <TableRow key={item.id}>
                  <TableCell className="min-w-48 max-w-80 whitespace-normal">
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-base-content/70">
                      {new Date(item.occurredAt).toLocaleString("zh-CN", { hour12: false })}
                    </p>
                    <p className="mt-1 text-xs text-base-content/70">
                      {environmentLabel(item.environment) || "全部环境"}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-36 whitespace-normal">
                    <strong>{formatMetricValue(item.metric, item.value)}</strong>
                    <p className="mt-1 text-xs text-base-content/70">
                      {metricDefinitions[item.metric].label} {comparatorLabels[item.comparator]}{" "}
                      {formatMetricValue(item.metric, item.threshold)}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-48 max-w-80 whitespace-normal">
                    <StatusBadge tone={state.tone} label={state.label} />
                    {item.deliveries.length ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm underline underline-offset-4">
                          查看 {item.deliveries.length} 个渠道结果
                        </summary>
                        <ul className="mt-3 grid gap-3" aria-label={`${item.title} 的渠道结果`}>
                          {item.deliveries.map((delivery) => (
                            <li key={delivery.channelId} className="text-sm">
                              <div className="flex items-center gap-2">
                                <ChannelKindIcon kind={delivery.channelKind} size="sm" />
                                <span className="font-medium">{delivery.channelName}</span>
                              </div>
                              <p
                                className={`mt-1 ${delivery.status === "failed" ? "text-error" : "text-base-content/70"}`}
                              >
                                {delivery.status === "failed"
                                  ? deliveryErrorText(delivery.errorCode)
                                  : "渠道已接受通知"}
                              </p>
                              <p className="mt-1 text-xs text-base-content/70">
                                已尝试 {delivery.attempts} 次 ·{" "}
                                {new Date(delivery.at).toLocaleString("zh-CN")}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <p className="mt-2 text-xs text-base-content/70">
                        {item.delivery === "cooldown"
                          ? "冷却期内不重复发送"
                          : item.delivery === "no_channels"
                            ? "本次没有向外部渠道发送"
                            : "等待投递结果；失败时每个渠道最多尝试 3 次"}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <a href={item.deepLink}>
                        诊断
                        <ArrowRightIcon />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!visible.length ? (
          <div className="flex flex-col items-center gap-3 p-8">
            <p>没有符合条件的触发记录</p>
            <Button
              variant="outline"
              onClick={() => {
                setFilter("all");
                setRuleFilter("all");
              }}
            >
              清除筛选
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
