import { CopyIcon, EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AlertRule, AlertRuleInput, NotificationChannel } from "@/lib/api/alerts";
import { ChannelKindIcon } from "@/features/settings/channels/ChannelKindIcon";
import { conditionText, formatDuration, ruleStatusLabels, ruleTemplates } from "./alertRules";
import { StatusBadge } from "./StatusBadge";

export function RulesTable({
  rules,
  channels,
  canManage,
  defaultEnvironment,
  toggling,
  onCreate,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  rules: AlertRule[];
  channels: NotificationChannel[];
  canManage: boolean;
  defaultEnvironment: string;
  toggling: boolean;
  onCreate: (initial?: AlertRuleInput) => void;
  onEdit: (rule: AlertRule) => void;
  onDuplicate: (rule: AlertRule) => void;
  onToggle: (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
}) {
  if (!rules.length)
    return (
      <RuleTemplates canManage={canManage} environment={defaultEnvironment} onCreate={onCreate} />
    );
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>规则</TableHead>
            <TableHead>环境</TableHead>
            <TableHead>通知渠道</TableHead>
            <TableHead>最近状态</TableHead>
            <TableHead>启用</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => {
            const status = ruleStatusLabels[rule.lastStatus];
            const ruleChannels = rule.channelIds
              .map((id) => byId.get(id))
              .filter((channel): channel is NotificationChannel => Boolean(channel));
            return (
              <TableRow key={rule.id} data-disabled={!rule.enabled || undefined}>
                <TableCell>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {canManage ? (
                      <button
                        type="button"
                        className="w-fit truncate text-left font-medium hover:underline"
                        onClick={() => onEdit(rule)}
                      >
                        {rule.name}
                      </button>
                    ) : (
                      <span className="truncate font-medium">{rule.name}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {conditionText(rule)} · 冷却 {formatDuration(rule.cooldownMinutes)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {rule.environment || "全部环境"}
                </TableCell>
                <TableCell>
                  {ruleChannels.length ? (
                    <ul className="flex flex-wrap gap-1.5" aria-label="通知渠道">
                      {ruleChannels.map((channel) => (
                        <li
                          key={channel.id}
                          className="inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-xs"
                          title={channel.enabled ? undefined : "渠道已停用"}
                        >
                          <ChannelKindIcon kind={channel.kind} size="sm" />
                          <span
                            className={channel.enabled ? "" : "text-muted-foreground line-through"}
                          >
                            {channel.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-muted-foreground">仅在控制台记录</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={rule.enabled ? status.tone : "muted"}
                    label={rule.enabled ? status.label : "已停用"}
                    title={
                      rule.lastEvaluatedAt
                        ? `最近评估：${new Date(rule.lastEvaluatedAt).toLocaleString("zh-CN")}`
                        : undefined
                    }
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={rule.enabled}
                    disabled={!canManage || toggling}
                    onCheckedChange={() => onToggle(rule)}
                    aria-label={`${rule.enabled ? "停用" : "启用"}规则 ${rule.name}`}
                  />
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`${rule.name} 的操作`}>
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(rule)}>
                          <PencilIcon />
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onDuplicate(rule)}>
                          <CopyIcon />
                          复制
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(rule)}>
                          <Trash2Icon />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RuleTemplates({
  canManage,
  environment,
  onCreate,
}: {
  canManage: boolean;
  environment: string;
  onCreate: (initial?: AlertRuleInput) => void;
}) {
  return (
    <section
      aria-labelledby="alert-templates-title"
      className="flex flex-col gap-4 rounded-2xl border border-dashed p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="alert-templates-title" className="text-base font-semibold">
          从模板开始
        </h2>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "选一个模板打开编辑器，调整阈值和通知渠道后再保存。"
            : "这个项目还没有告警规则。组织成员以上的角色可以创建规则。"}
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {ruleTemplates(environment).map((template) => (
          <li key={template.id}>
            <button
              type="button"
              disabled={!canManage}
              onClick={() => onCreate(template.rule)}
              className="alert-template-card flex h-full w-full flex-col gap-1 rounded-2xl border bg-card p-4 text-left"
            >
              <span className="text-sm font-medium">{template.rule.name}</span>
              <span className="text-xs text-muted-foreground">{template.description}</span>
            </button>
          </li>
        ))}
      </ul>
      {canManage ? (
        <Button variant="outline" className="w-fit" onClick={() => onCreate()}>
          <PlusIcon data-icon="inline-start" />
          从空白开始
        </Button>
      ) : null}
    </section>
  );
}
