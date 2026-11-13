import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon, XIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
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
import { notificationTargets } from "./alertPresentation";
import { HTTPError } from "@/lib/auth/session";
import { ChannelKindIcon } from "@/features/settings/channels/ChannelKindIcon";
import { ChannelDialog, type ChannelDialogState } from "@/features/settings/channels/ChannelDialog";
import { channelKinds } from "@/features/settings/channels/channelKinds";
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
import { environmentLabel, projectEnvironments } from "@/lib/projects/environments";

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
  const queryClient = useQueryClient();
  const [channelEditor, setChannelEditor] = useState<ChannelDialogState | null>(null);
  const [channelNotice, setChannelNotice] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [initial] = useState(() => initialInput(state, rules, defaultEnvironment));
  const [input, setInput] = useState(initial);
  const [thresholdText, setThresholdText] = useState(() => String(initial.threshold));
  const [touched, setTouched] = useState(false);
  const editing = state.mode === "edit";
  const errors = validateRule(input);
  const definition = metricDefinitions[input.metric];
  const selectedChannels = channels.filter((channel) => input.channelIds.includes(channel.id));
  const targets = notificationTargets(input, channels);
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
  const requestClose = () => {
    if (save.isPending) return;
    if (JSON.stringify(input) !== JSON.stringify(initial)) setDiscarding(true);
    else onClose();
  };
  const serverMessage =
    save.error instanceof HTTPError && save.error.status === 409
      ? "这个项目里已有同名规则，请换一个名称。"
      : save.error
        ? "保存失败，草稿已保留，请检查后重试。"
        : "";
  const environments = Array.from(
    new Set([
      ...projectEnvironments.map((item) => item.id),
      ...(input.environment ? [input.environment] : []),
    ]),
  );
  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        style={{ width: "min(100vw, 920px)", maxWidth: "none" }}
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-base-300 pr-14">
          <SheetTitle>
            {editing
              ? "编辑告警规则"
              : state.mode === "duplicate"
                ? "复制告警规则"
                : "新建告警规则"}
          </SheetTitle>
          <SheetDescription>{project.name} · 配置监控条件与通知去向</SheetDescription>
        </SheetHeader>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 right-4"
          onClick={requestClose}
          aria-label="关闭规则编辑器"
        >
          <XIcon />
        </Button>
        <form
          id={`${id}-form`}
          noValidate
          className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-4 pb-6 md:grid-cols-[minmax(0,1fr)_240px]"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!Object.keys(errors).length) save.mutate();
            else document.getElementById(`${id}-${errors.name ? "name" : "threshold"}`)?.focus();
          }}
        >
          <div className="flex min-w-0 flex-col gap-6">
            <fieldset className="fieldset gap-4">
              <legend className="fieldset-legend text-base">1. 监控对象</legend>
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>规则名称</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={input.name}
                  maxLength={120}
                  placeholder="例如：生产环境错误率超标"
                  aria-invalid={touched && Boolean(errors.name)}
                  onChange={(event) => update({ name: event.target.value })}
                />
                {touched && errors.name ? <FieldError>{errors.name}</FieldError> : null}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-metric`}>指标</FieldLabel>
                  <select
                    id={`${id}-metric`}
                    className="select w-full"
                    value={input.metric}
                    onChange={(event) => {
                      const metric = event.target.value as AlertMetric;
                      const threshold =
                        metric === "lcp_p75"
                          ? 2500
                          : metric === "error_count"
                            ? 10
                            : metric === "api_failure_rate"
                              ? 5
                              : 2;
                      update({ metric, threshold });
                      setThresholdText(String(threshold));
                    }}
                  >
                    {alertMetrics.map((metric) => (
                      <option key={metric} value={metric}>
                        {metricDefinitions[metric].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-environment`}>环境</FieldLabel>
                  <select
                    id={`${id}-environment`}
                    className="select w-full"
                    value={input.environment || allEnvironments}
                    onChange={(event) =>
                      update({
                        environment:
                          event.target.value === allEnvironments ? "" : event.target.value,
                      })
                    }
                  >
                    <option value={allEnvironments}>全部环境（合并评估）</option>
                    {environments.map((environment) => (
                      <option key={environment} value={environment}>
                        {environmentLabel(environment)} · {environment}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="text-sm text-base-content/70">{definition.description}</p>
            </fieldset>
            <fieldset className="fieldset gap-4 border-t border-base-300">
              <legend className="fieldset-legend text-base">2. 触发条件</legend>
              <Field>
                <FieldLabel htmlFor={`${id}-threshold`}>触发条件</FieldLabel>
                <div className="flex gap-2">
                  <select
                    className="select w-28"
                    aria-label="比较方式"
                    value={input.comparator}
                    onChange={(event) =>
                      update({ comparator: event.target.value as AlertComparator })
                    }
                  >
                    <option value="gte">{comparatorLabels.gte} 达到</option>
                    <option value="gt">{comparatorLabels.gt} 超过</option>
                  </select>
                  <label className="input min-w-0 flex-1">
                    <input
                      id={`${id}-threshold`}
                      inputMode="decimal"
                      className="min-w-0 w-full"
                      value={thresholdText}
                      aria-invalid={touched && Boolean(errors.threshold)}
                      onChange={(event) => {
                        setThresholdText(event.target.value);
                        update({
                          threshold:
                            event.target.value.trim() === ""
                              ? Number.NaN
                              : Number(event.target.value),
                        });
                      }}
                    />
                    <span className="text-base-content/70">{definition.unitLabel}</span>
                  </label>
                </div>
                {touched && errors.threshold ? <FieldError>{errors.threshold}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-window`}>统计窗口</FieldLabel>
                <select
                  id={`${id}-window`}
                  className="select w-full"
                  value={input.windowMinutes}
                  onChange={(event) => update({ windowMinutes: Number(event.target.value) })}
                >
                  {windowOptions.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatDuration(minutes)}
                    </option>
                  ))}
                </select>
                <FieldDescription>
                  每分钟检查最近已完成的固定窗口，不是滑动窗口。短窗口响应更快，也更容易受到偶发波动影响。
                </FieldDescription>
              </Field>
            </fieldset>
            <fieldset className="fieldset gap-4 border-t border-base-300">
              <legend className="fieldset-legend text-base">3. 通知设置</legend>
              <Field>
                <FieldLabel id={`${id}-channels`}>通知渠道</FieldLabel>
                {channels.length ? (
                  <ul className="grid gap-2" aria-labelledby={`${id}-channels`}>
                    {channels.map((channel) => (
                      <li key={channel.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-field border border-base-300 p-3">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={input.channelIds.includes(channel.id)}
                            disabled={!channel.enabled && !input.channelIds.includes(channel.id)}
                            onChange={(event) =>
                              update({
                                channelIds: event.target.checked
                                  ? [...input.channelIds, channel.id]
                                  : input.channelIds.filter((value) => value !== channel.id),
                              })
                            }
                          />
                          <ChannelKindIcon kind={channel.kind} size="sm" />
                          <span className="min-w-0 flex-1 break-words">
                            {channel.name}
                            {!channel.enabled ? (
                              <span className="ml-2 text-base-content/70">（已停用）</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-base-content/70">
                    还没有渠道。可以先创建仅在控制台记录的规则，之后再添加通知。
                  </p>
                )}
                {canManageChannels ? (
                  <div className="flex flex-wrap gap-2">
                    {channelKinds
                      .filter((kind) => kind.status === "available")
                      .map((kind) => (
                        <Button
                          key={kind.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setChannelEditor({ mode: "create", kind })}
                        >
                          添加{kind.name}渠道
                        </Button>
                      ))}
                  </div>
                ) : (
                  <FieldDescription>通知渠道由组织的 Owner 或 Admin 配置。</FieldDescription>
                )}
                {channelNotice ? (
                  <p role="status" className="text-sm text-base-content/70">
                    {channelNotice} 请勾选要通知的渠道。
                  </p>
                ) : null}
                {errors.channelIds ? <FieldError>{errors.channelIds}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-cooldown`}>重复通知间隔</FieldLabel>
                <select
                  id={`${id}-cooldown`}
                  className="select w-full"
                  value={input.cooldownMinutes}
                  onChange={(event) => update({ cooldownMinutes: Number(event.target.value) })}
                >
                  {Array.from(new Set([...cooldownOptions, input.cooldownMinutes]))
                    .sort((a, b) => a - b)
                    .map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatDuration(minutes)}
                      </option>
                    ))}
                </select>
                <FieldDescription>
                  通知成功后，在此间隔内继续命中阈值只记录，不重复发送。
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  id={`${id}-enabled`}
                  checked={input.enabled}
                  onCheckedChange={(enabled) => update({ enabled })}
                />
                <FieldLabel htmlFor={`${id}-enabled`} className="font-normal">
                  {editing ? "启用这条规则" : "保存后立即启用"}
                </FieldLabel>
              </Field>
            </fieldset>
            {serverMessage ? (
              <p role="alert" className="alert alert-soft alert-error">
                {serverMessage}
              </p>
            ) : null}
          </div>
          <aside className="self-start md:sticky md:top-0">
            <div className="card card-border bg-base-200">
              <div className="card-body gap-4">
                <h2 className="font-semibold">规则预览</h2>
                <p className="text-sm" aria-live="polite">
                  {Number.isFinite(input.threshold)
                    ? ruleSummary(
                        input,
                        selectedChannels
                          .filter((channel) => channel.enabled)
                          .map((channel) => channel.name),
                        targets.warning,
                      )
                    : "填写阈值后查看触发条件。"}
                </p>
                <dl className="grid gap-4 border-t border-base-300 pt-4 text-sm">
                  <div>
                    <dt className="text-base-content/70">保存后的状态</dt>
                    <dd className="mt-1">
                      {input.enabled ? "启用，等待窗口评估" : "停用，暂不评估"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/70">通知去向</dt>
                    <dd className="mt-1 break-words">{targets.label}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/70">发生异常后</dt>
                    <dd className="mt-1">查看触发记录 → 检查渠道结果 → 进入诊断</dd>
                  </div>
                </dl>
              </div>
            </div>
            {targets.warning ? (
              <p role="status" className="alert alert-soft alert-warning mt-3 text-sm">
                选中的部分渠道不可用，请检查后保存。
              </p>
            ) : null}
          </aside>
        </form>
        <SheetFooter className="flex-row items-center justify-between border-t border-base-300">
          <p className="text-xs text-base-content/70">
            {input.enabled ? "保存后生效" : "保存为停用规则"}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
              disabled={save.isPending}
            >
              取消
            </Button>
            <Button type="submit" form={`${id}-form`} disabled={save.isPending}>
              {save.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
              {editing ? "保存修改" : "创建规则"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
      {channelEditor ? (
        <ChannelDialog
          organizationId={project.organizationId}
          state={channelEditor}
          onClose={() => setChannelEditor(null)}
          onSaved={(message) => {
            setChannelEditor(null);
            setChannelNotice(message);
            void queryClient.invalidateQueries({ queryKey: ["channels", project.organizationId] });
          }}
        />
      ) : null}
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              这条规则尚未保存。可以继续编辑，或放弃本次修改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onClose}>
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
