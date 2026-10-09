import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  alertMetrics,
  createAlert,
  updateAlert,
  type AlertComparator,
  type AlertMetric,
  type AlertRule,
  type AlertRuleInput,
  type NotificationChannel,
} from "@/lib/api/alerts";
import type { Project } from "@/lib/api/projects";
import { HTTPError } from "@/lib/auth/session";
import { ChannelKindIcon } from "@/features/settings/channels/ChannelKindIcon";
import {
  blankRule,
  comparatorLabels,
  cooldownOptions,
  copyName,
  formatDuration,
  metricDefinitions,
  ruleSummary,
  validateRule,
  windowOptions,
} from "./alertRules";
import { projectEnvironments } from "@/lib/projects/environments";

export type RuleEditorState =
  | { mode: "create"; initial?: AlertRuleInput }
  | { mode: "edit"; rule: AlertRule }
  | { mode: "duplicate"; rule: AlertRule };

const allEnvironments = "__all__";

function initialInput(
  state: RuleEditorState,
  rules: AlertRule[],
  environment: string,
): AlertRuleInput {
  if (state.mode === "create") return state.initial ?? blankRule(environment);
  const { rule } = state;
  const input: AlertRuleInput = {
    name: rule.name,
    metric: rule.metric,
    comparator: rule.comparator,
    threshold: rule.threshold,
    windowMinutes: rule.windowMinutes,
    cooldownMinutes: rule.cooldownMinutes,
    environment: rule.environment,
    enabled: rule.enabled,
    channelIds: rule.channelIds,
  };
  if (state.mode === "duplicate")
    return {
      ...input,
      name: copyName(
        rule.name,
        rules.map((item) => item.name),
      ),
    };
  return input;
}

export function RuleEditor({
  project,
  state,
  rules,
  channels,
  canManageChannels,
  defaultEnvironment,
  onClose,
  onSaved,
}: {
  project: Project;
  state: RuleEditorState;
  rules: AlertRule[];
  channels: NotificationChannel[];
  canManageChannels: boolean;
  defaultEnvironment: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  const editing = state.mode === "edit";
  const [input, setInput] = useState(() => initialInput(state, rules, defaultEnvironment));
  const [thresholdText, setThresholdText] = useState(() => String(input.threshold));
  const [touched, setTouched] = useState(false);
  const errors = validateRule(input);
  const valid = Object.keys(errors).length === 0;
  const definition = metricDefinitions[input.metric];
  const selectedChannels = channels.filter((channel) => input.channelIds.includes(channel.id));
  const environments = Array.from(
    new Set([
      ...projectEnvironments.map((item) => item.id),
      ...(input.environment ? [input.environment] : []),
    ]),
  );
  const update = (patch: Partial<AlertRuleInput>) =>
    setInput((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateAlert(project.id, state.rule.id, { ...input, name: input.name.trim() })
        : createAlert(project.id, { ...input, name: input.name.trim() }),
    onSuccess: (rule) =>
      onSaved(editing ? `已保存规则「${rule.name}」。` : `已创建规则「${rule.name}」。`),
  });
  const serverMessage =
    save.error instanceof HTTPError && save.error.status === 409
      ? "这个项目里已有同名规则，请换一个名称。"
      : save.error instanceof HTTPError && save.error.status === 400
        ? "规则设置无效，请检查各项取值。"
        : save.error
          ? "保存失败，请稍后重试。"
          : "";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        style={{ width: "min(100vw, 560px)", maxWidth: "none" }}
        className="flex flex-col"
      >
        <SheetHeader>
          <SheetTitle>{editing ? "编辑告警规则" : "新建告警规则"}</SheetTitle>
          <SheetDescription>
            {project.name} · 规则每分钟评估一次，按固定时间窗口统计。
          </SheetDescription>
        </SheetHeader>
        <form
          id={`${id}-form`}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (valid) save.mutate();
          }}
        >
          <Field data-invalid={touched && Boolean(errors.name)}>
            <FieldLabel htmlFor={`${id}-name`}>规则名称</FieldLabel>
            <Input
              id={`${id}-name`}
              value={input.name}
              maxLength={120}
              placeholder="如：结账页错误率突增"
              aria-invalid={touched && Boolean(errors.name)}
              onChange={(event) => update({ name: event.target.value })}
            />
            {touched && errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor={`${id}-metric`}>指标</FieldLabel>
            <Select
              value={input.metric}
              onValueChange={(value) => update({ metric: value as AlertMetric })}
            >
              <SelectTrigger id={`${id}-metric`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {alertMetrics.map((metric) => (
                  <SelectItem key={metric} value={metric}>
                    {metricDefinitions[metric].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{definition.description}</FieldDescription>
          </Field>

          <Field data-invalid={touched && Boolean(errors.threshold)}>
            <FieldLabel htmlFor={`${id}-threshold`}>触发条件</FieldLabel>
            <div className="flex gap-2">
              <Select
                value={input.comparator}
                onValueChange={(value) => update({ comparator: value as AlertComparator })}
              >
                <SelectTrigger className="w-24" aria-label="比较方式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gte">{comparatorLabels.gte} 达到</SelectItem>
                  <SelectItem value="gt">{comparatorLabels.gt} 超过</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Input
                  id={`${id}-threshold`}
                  inputMode="decimal"
                  value={thresholdText}
                  aria-invalid={touched && Boolean(errors.threshold)}
                  className="pr-10"
                  onChange={(event) => {
                    setThresholdText(event.target.value);
                    const parsed = Number(event.target.value);
                    update({ threshold: event.target.value.trim() === "" ? Number.NaN : parsed });
                  }}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  {definition.unitLabel}
                </span>
              </div>
            </div>
            {touched && errors.threshold ? <FieldError>{errors.threshold}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel id={`${id}-window`}>统计窗口</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={`${id}-window`}
              value={String(input.windowMinutes)}
              onValueChange={(value) => value && update({ windowMinutes: Number(value) })}
            >
              {windowOptions.map((minutes) => (
                <ToggleGroupItem key={minutes} value={String(minutes)}>
                  {formatDuration(minutes)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              每个窗口结束后统计一次，窗口越短越灵敏，也越容易误报。
            </FieldDescription>
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-environment`}>环境</FieldLabel>
              <Select
                value={input.environment || allEnvironments}
                onValueChange={(value) =>
                  update({ environment: value === allEnvironments ? "" : value })
                }
              >
                <SelectTrigger id={`${id}-environment`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allEnvironments}>全部环境</SelectItem>
                  {environments.map((environment) => (
                    <SelectItem key={environment} value={environment}>
                      {environment}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-cooldown`}>冷却时间</FieldLabel>
              <Select
                value={String(input.cooldownMinutes)}
                onValueChange={(value) => update({ cooldownMinutes: Number(value) })}
              >
                <SelectTrigger id={`${id}-cooldown`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set([...cooldownOptions, input.cooldownMinutes]))
                    .sort((a, b) => a - b)
                    .map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {formatDuration(minutes)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field data-invalid={Boolean(errors.channelIds)}>
            <FieldLabel id={`${id}-channels`}>通知渠道</FieldLabel>
            {channels.length ? (
              <ul className="grid gap-2 sm:grid-cols-2" aria-labelledby={`${id}-channels`}>
                {channels.map((channel) => {
                  const selected = input.channelIds.includes(channel.id);
                  return (
                    <li key={channel.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          update({
                            channelIds: selected
                              ? input.channelIds.filter((item) => item !== channel.id)
                              : [...input.channelIds, channel.id],
                          })
                        }
                        className="alert-channel-option flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm"
                      >
                        <ChannelKindIcon kind={channel.kind} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                        {!channel.enabled ? <Badge variant="secondary">已停用</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                组织里还没有通知渠道，规则触发时只在控制台记录。
              </p>
            )}
            <FieldDescription>
              {canManageChannels ? (
                <Link to="/settings/org/channels" className="underline underline-offset-4">
                  {channels.length ? "管理通知渠道" : "去添加通知渠道，比如飞书群机器人"}
                </Link>
              ) : (
                "通知渠道由组织的 Owner 或 Admin 配置。"
              )}
            </FieldDescription>
            {errors.channelIds ? <FieldError>{errors.channelIds}</FieldError> : null}
          </Field>

          <Field orientation="horizontal">
            <Switch
              id={`${id}-enabled`}
              checked={input.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
            <FieldLabel htmlFor={`${id}-enabled`} className="font-normal">
              保存后立即启用
            </FieldLabel>
          </Field>

          <p className="rounded-md bg-muted px-3 py-2.5 text-sm" aria-live="polite">
            {Number.isFinite(input.threshold)
              ? ruleSummary(
                  input,
                  selectedChannels.map((channel) => channel.name),
                )
              : "填写阈值后，这里会用一句话概括这条规则。"}
          </p>
          {serverMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {serverMessage}
            </p>
          ) : null}
        </form>
        <SheetFooter className="flex-row justify-end border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={save.isPending}>
            {save.isPending ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : null}
            {editing ? "保存修改" : "创建规则"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
