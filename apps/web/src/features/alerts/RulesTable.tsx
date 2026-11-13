import { useState } from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  EllipsisIcon,
  GaugeIcon,
  PencilIcon,
  PlusIcon,
  TrendingUpIcon,
  Trash2Icon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AlertMetric,
  AlertNotification,
  AlertRule,
  AlertRuleInput,
  NotificationChannel,
} from "@/lib/api/alerts";
import { environmentLabel } from "@/lib/projects/environments";
import {
  conditionText,
  deliveryStateLabels,
  formatDuration,
  ruleStatusLabels,
  ruleTemplates,
} from "./alertRules";
import {
  filterRules,
  formatRelativeTime,
  latestRuleNotification,
  notificationTargets,
  rankRules,
  ruleAttentions,
  type RuleFilter,
} from "./alertPresentation";
import { StatusBadge } from "./StatusBadge";

const filterOptions: { value: RuleFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "breached", label: "超阈值" },
  { value: "attention", label: "需处理" },
  { value: "disabled", label: "已停用" },
];

const toneText = {
  ok: "text-success",
  danger: "text-error",
  warning: "text-warning",
  muted: "text-base-content/70",
} as const;

export function RulesTable({
  rules,
  channels,
  notifications = [],
  canManage,
  defaultEnvironment,
  toggling,
  filter,
  onFilterChange,
  onCreate,
  onInspect,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
  channelsAvailable = true,
  canCreate = canManage,
}: {
  rules: AlertRule[];
  channels: NotificationChannel[];
  notifications?: AlertNotification[];
  canManage: boolean;
  defaultEnvironment: string;
  toggling: boolean;
  filter: RuleFilter;
  onFilterChange: (filter: RuleFilter) => void;
  onCreate: (initial?: AlertRuleInput) => void;
  onInspect: (rule: AlertRule) => void;
  onEdit: (rule: AlertRule) => void;
  onDuplicate: (rule: AlertRule) => void;
  onToggle: (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
  channelsAvailable?: boolean;
  canCreate?: boolean;
}) {
  const [search, setSearch] = useState("");
  if (!rules.length)
    return (
      <FirstRun
        canManage={canManage}
        canCreate={canCreate}
        environment={defaultEnvironment}
        channels={channels}
        channelsAvailable={channelsAvailable}
        onCreate={onCreate}
      />
    );
  const attention = ruleAttentions(rules, notifications, channels, channelsAvailable);
  const visible = rankRules(filterRules(rules, search, filter, attention), attention);
  const enabledCount = rules.filter((rule) => rule.enabled).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3" role="search" aria-label="筛选告警规则">
        <input
          className="input input-sm min-w-0 flex-1 sm:max-w-xs"
          aria-label="搜索规则"
          placeholder="搜索规则名称或环境"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="join" role="group" aria-label="按状态筛选">
          {filterOptions.map((option) => {
            const count = filterRules(rules, "", option.value, attention).length;
            const active = filter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                disabled={!active && option.value !== "all" && count === 0}
                className={cn("btn btn-sm join-item", active && "btn-active")}
                onClick={() => onFilterChange(option.value)}
              >
                {option.label}
                <span className="text-base-content/70">{count}</span>
              </button>
            );
          })}
        </div>
        <span className="text-sm text-base-content/70" role="status">
          {visible.length} / {rules.length} 条规则 · {enabledCount} 条已启用 · 每 30 秒更新
        </span>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto" disabled={!canCreate}>
                <PlusIcon data-icon="inline-start" />
                从模板添加
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {ruleTemplates(defaultEnvironment).map((template) => (
                <DropdownMenuItem key={template.id} onSelect={() => onCreate(template.rule)}>
                  <TemplateIcon metric={template.rule.metric} />
                  <span className="flex flex-col">
                    <span>{template.rule.name}</span>
                    <span className="text-xs text-base-content/70">{template.description}</span>
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onCreate()}>
                <PlusIcon />
                空白规则
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="card card-border overflow-hidden bg-base-100">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>规则与条件</TableHead>
              <TableHead>当前状态 · 最近 24 次评估</TableHead>
              <TableHead>最近触发</TableHead>
              <TableHead>通知去向</TableHead>
              <TableHead>启用</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((rule) => {
              const status = ruleStatusLabels[rule.lastStatus];
              const targets = notificationTargets(rule, channels, channelsAvailable);
              const last = latestRuleNotification(notifications, rule.id);
              const lastState = last ? lastTriggerState(last) : null;
              return (
                <TableRow
                  key={rule.id}
                  className="cursor-pointer hover:bg-base-200/50"
                  onClick={(event) => {
                    // Controls inside the row keep their own behaviour.
                    if ((event.target as HTMLElement).closest("button,a,input,[role=switch]"))
                      return;
                    onInspect(rule);
                  }}
                >
                  <TableCell className="min-w-64 max-w-96 whitespace-normal">
                    <button
                      type="button"
                      className="link link-hover text-left font-semibold break-words"
                      onClick={() => onInspect(rule)}
                    >
                      {rule.name}
                    </button>
                    <p className="mt-1 text-sm text-base-content/70">{conditionText(rule)}</p>
                    <p className="mt-1 text-xs text-base-content/70">
                      {environmentLabel(rule.environment) || "全部环境"} · 通知间隔{" "}
                      {formatDuration(rule.cooldownMinutes)}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-56">
                    <StatusBadge
                      tone={rule.enabled ? status.tone : "muted"}
                      label={rule.enabled ? status.label : "已停用"}
                    />
                    {rule.enabled ? (
                      <EvaluationBars statuses={rule.recentStatuses} />
                    ) : (
                      <p className="mt-2 text-xs text-base-content/70">不再评估</p>
                    )}
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal">
                    {last && lastState ? (
                      <>
                        <p className="text-sm">{formatRelativeTime(last.occurredAt)}</p>
                        <p className={cn("mt-1 text-xs", toneText[lastState.tone])}>
                          {lastState.label}
                        </p>
                      </>
                    ) : (
                      <span className="text-sm text-base-content/70">尚未触发</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <span className={targets.warning ? "text-warning" : "text-base-content/70"}>
                      {targets.label}
                    </span>
                    {targets.warning ? (
                      <p className="mt-1 text-xs text-base-content/70">
                        <Link to="/settings/org/channels" className="link">
                          检查组织渠道配置
                        </Link>
                      </p>
                    ) : null}
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
                          <DropdownMenuItem
                            disabled={!channelsAvailable}
                            onSelect={() => onEdit(rule)}
                          >
                            <PencilIcon />
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!channelsAvailable}
                            onSelect={() => onDuplicate(rule)}
                          >
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
        {!visible.length ? (
          <div className="flex flex-col items-center gap-3 p-8">
            <p>没有符合条件的规则</p>
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                onFilterChange("all");
              }}
            >
              清除筛选
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-base-content/70">
        状态来自最近一次固定窗口评估，不代表持续故障或恢复状态。规则每分钟检查一次。
      </p>
    </div>
  );
}

function lastTriggerState(item: AlertNotification) {
  const state = deliveryStateLabels[item.delivery];
  const failedChannel = item.deliveries.find((delivery) => delivery.status === "failed");
  const failing = item.delivery === "failed" || item.delivery === "partial";
  return {
    tone: state.tone,
    label: failing && failedChannel ? `${failedChannel.channelName} 发送失败` : state.label,
  };
}

const barTone: Record<string, string> = {
  breached: "h-4 bg-error",
  suppressed: "h-4 bg-error",
  failed: "h-4 bg-warning",
};

/** One bar per evaluation, oldest first: tall and coloured when it breached or failed. */
function EvaluationBars({ statuses }: { statuses: string[] }) {
  if (!statuses.length) return <p className="mt-2 text-xs text-base-content/70">等待首次评估</p>;
  const breached = statuses.filter((item) => item === "breached" || item === "suppressed").length;
  const failed = statuses.filter((item) => item === "failed").length;
  return (
    <div
      role="img"
      aria-label={`最近 ${statuses.length} 次评估：${breached} 次超过阈值，${failed} 次评估失败`}
      className="mt-2 flex h-4 items-end gap-0.5"
    >
      {statuses.map((status, index) => (
        <span
          key={index}
          className={cn("w-1.5 rounded-[1px]", barTone[status] ?? "h-1.5 bg-base-content/50")}
        />
      ))}
    </div>
  );
}

const templateIcons: Record<AlertMetric, typeof ActivityIcon> = {
  error_count: CircleAlertIcon,
  error_rate: TrendingUpIcon,
  api_failure_rate: ActivityIcon,
  lcp_p75: GaugeIcon,
};

function TemplateIcon({ metric, tile = false }: { metric: AlertMetric; tile?: boolean }) {
  const Icon = templateIcons[metric];
  return tile ? (
    <span className="grid size-9 shrink-0 place-items-center rounded-field bg-base-200">
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  ) : (
    <Icon aria-hidden="true" />
  );
}

/** No rules yet: pick a template on the left, follow the real setup progress on the right. */
function FirstRun({
  canManage,
  canCreate,
  environment,
  channels,
  channelsAvailable,
  onCreate,
}: {
  canManage: boolean;
  canCreate: boolean;
  environment: string;
  channels: NotificationChannel[];
  channelsAvailable: boolean;
  onCreate: (initial?: AlertRuleInput) => void;
}) {
  const channelCount = channels.filter((channel) => channel.enabled).length;
  const done = channelsAvailable && channelCount > 0 ? 1 : 0;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <RuleTemplates
        canManage={canManage}
        canCreate={canCreate}
        environment={environment}
        onCreate={onCreate}
        firstRun
      />
      <section aria-labelledby="alert-steps-title" className="card card-border bg-base-100">
        <div className="card-body gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="alert-steps-title" className="card-title text-base">
              开始前的 3 步
            </h2>
            <span className="text-sm text-base-content/70">已完成 {done} / 3</span>
          </div>
          <progress
            className="progress progress-primary"
            value={done}
            max={3}
            aria-label="完成进度"
          />
          <ol className="flex flex-col gap-5" aria-label="配置步骤">
            <Step
              state={done ? "done" : "todo"}
              index={1}
              title="连接通知渠道"
              badge={
                !channelsAvailable ? null : done ? (
                  <span className="badge badge-sm badge-soft badge-success">
                    已连接 {channelCount} 个
                  </span>
                ) : (
                  <span className="badge badge-sm badge-soft badge-warning">未配置</span>
                )
              }
            >
              <p className="text-sm text-base-content/70">
                支持飞书和 Webhook。可以先跳过，触发时只会记录在控制台。
              </p>
              {!done ? (
                <Button asChild variant="outline" size="sm" className="self-start">
                  <Link to="/settings/org/channels">去配置渠道</Link>
                </Button>
              ) : null}
            </Step>
            <Step state="current" index={2} title="创建第一条规则">
              <p className="text-sm text-base-content/70">
                从左边选一个模板，调整阈值后保存才会生效。
              </p>
            </Step>
            <Step state="todo" index={3} title="确认送达">
              <p className="text-sm text-base-content/70">
                规则触发后，在「触发记录」查看每个渠道的结果并进入诊断。
              </p>
            </Step>
          </ol>
        </div>
      </section>
    </div>
  );
}

function Step({
  state,
  index,
  title,
  badge,
  children,
}: {
  state: "done" | "current" | "todo";
  index: number;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
          state === "done" && "bg-success text-success-content",
          state === "current" && "border-2 border-primary",
          state === "todo" && "border border-base-300 text-base-content/70",
        )}
      >
        {state === "done" ? <CheckIcon className="size-3.5" /> : index}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="font-semibold">{title}</strong>
          {badge}
        </div>
        {children}
      </div>
    </li>
  );
}

export function RuleTemplates({
  canManage,
  environment,
  onCreate,
  firstRun = false,
  canCreate = canManage,
}: {
  canManage: boolean;
  environment: string;
  onCreate: (initial?: AlertRuleInput) => void;
  firstRun?: boolean;
  canCreate?: boolean;
}) {
  return (
    <section
      aria-labelledby="alert-templates-title"
      className={firstRun ? "card card-border bg-base-100" : undefined}
    >
      <div className={firstRun ? "card-body gap-5" : "flex flex-col gap-5"}>
        <div>
          <h2 id="alert-templates-title" className="card-title">
            {firstRun ? "先选一个你想监控的问题" : "选择一个起点"}
          </h2>
          <p className="mt-2 text-sm text-base-content/70">
            {canManage
              ? "模板只填入建议条件，阈值、环境和通知去向在保存前都能改。"
              : "这个项目还没有规则。组织成员、Admin 或 Owner 可以创建规则。"}
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ruleTemplates(environment).map((template) => (
            <li key={template.id}>
              <button
                type="button"
                disabled={!canManage || !canCreate}
                onClick={() => onCreate(template.rule)}
                className="card card-border h-full w-full flex-row items-start gap-3 p-4 text-left transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
              >
                <TemplateIcon metric={template.rule.metric} tile />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{template.rule.name}</span>
                  <span className="mt-1 block text-sm text-base-content/70">
                    {template.description}
                  </span>
                </span>
                <ArrowRightIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4 text-sm">
            <span className="text-base-content/70">这些都不是你要的？</span>
            <button
              type="button"
              className="link link-hover font-medium disabled:opacity-70"
              disabled={!canCreate}
              onClick={() => onCreate()}
            >
              从空白规则开始，自己选指标和条件
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
