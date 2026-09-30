import { useState } from "react";
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  comparatorLabels,
  deliveryErrorText,
  deliveryStateLabels,
  formatMetricValue,
  metricDefinitions,
} from "./alertRules";
import { StatusBadge } from "./StatusBadge";

const filters: Array<{ value: "all" | DeliveryState; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "delivered", label: "已送达" },
  { value: "failed", label: "发送失败" },
  { value: "partial", label: "部分失败" },
  { value: "cooldown", label: "冷却中" },
  { value: "no_channels", label: "未配置渠道" },
];

export function DeliveryLog({
  notifications,
  rules,
}: {
  notifications: AlertNotification[];
  rules: AlertRule[];
}) {
  const [filter, setFilter] = useState<"all" | DeliveryState>("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const visible = notifications.filter(
    (item) =>
      (filter === "all" || item.delivery === filter) &&
      (ruleFilter === "all" || item.ruleId === ruleFilter),
  );
  if (!notifications.length)
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>还没有通知</EmptyTitle>
          <EmptyDescription>
            规则触发后，每次通知和它在各个渠道的送达结果都会记录在这里。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="w-36" aria-label="送达状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filters.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {rules.length > 1 ? (
          <Select value={ruleFilter} onValueChange={setRuleFilter}>
            <SelectTrigger className="w-48" aria-label="规则">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部规则</SelectItem>
              {rules.map((rule) => (
                <SelectItem key={rule.id} value={rule.id}>
                  {rule.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-2xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>规则</TableHead>
              <TableHead>送达</TableHead>
              <TableHead>渠道结果</TableHead>
              <TableHead className="w-28">
                <span className="sr-only">诊断</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => {
              const state = deliveryStateLabels[item.delivery];
              return (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {new Date(item.occurredAt).toLocaleString("zh-CN", { hour12: false })}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {metricDefinitions[item.metric].label}{" "}
                        {formatMetricValue(item.metric, item.value)}
                        ，阈值 {comparatorLabels[item.comparator]}{" "}
                        {formatMetricValue(item.metric, item.threshold)}
                        {item.environment ? ` · ${item.environment}` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={state.tone} label={state.label} />
                  </TableCell>
                  <TableCell>
                    {item.deliveries.length ? (
                      <ul className="flex flex-wrap gap-1.5" aria-label="渠道结果">
                        {item.deliveries.map((delivery) => {
                          const failed = delivery.status === "failed";
                          const detail = failed
                            ? deliveryErrorText(delivery.errorCode)
                            : delivery.attempts > 1
                              ? `第 ${delivery.attempts} 次尝试送达`
                              : "已送达";
                          return (
                            <li
                              key={delivery.channelId}
                              title={detail}
                              className="inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-xs"
                            >
                              <ChannelKindIcon kind={delivery.channelKind} size="sm" />
                              <span>{delivery.channelName}</span>
                              {failed ? (
                                <XIcon
                                  className="size-3 text-[var(--ds-danger)]"
                                  aria-label={detail}
                                />
                              ) : (
                                <CheckIcon
                                  className="size-3 text-[var(--ds-success)]"
                                  aria-label={detail}
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {item.delivery === "cooldown"
                          ? "冷却期内，不重复通知"
                          : item.delivery === "no_channels"
                            ? "规则未配置渠道"
                            : "等待发送"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <a href={item.deepLink}>
                        进入诊断
                        <ExternalLinkIcon data-icon="inline-end" />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!visible.length ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            没有符合筛选条件的通知。
          </p>
        ) : null}
      </div>
    </div>
  );
}
