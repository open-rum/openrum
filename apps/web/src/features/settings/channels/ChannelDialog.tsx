import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  createChannel,
  testChannel,
  updateChannel,
  type NotificationChannel,
  type StoredChannelKind,
} from "@/lib/api/alerts";
import { HTTPError } from "@/lib/auth/session";
import { docsUrl } from "@/lib/docs";
import { deliveryErrorText } from "@/features/alerts/alertRules";
import { ChannelKindIcon } from "./ChannelKindIcon";
import type { ChannelKindDefinition } from "./channelKinds";

export type ChannelDialogState =
  | { mode: "create"; kind: ChannelKindDefinition }
  | { mode: "edit"; kind: ChannelKindDefinition; channel: NotificationChannel };

export function ChannelDialog({
  organizationId,
  state,
  onClose,
  onSaved,
}: {
  organizationId: string;
  state: ChannelDialogState;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  const editing = state.mode === "edit";
  const kind = state.kind;
  const [name, setName] = useState(editing ? state.channel.name : `${kind.name}通知`);
  const [values, setValues] = useState<Record<string, string>>({});
  const [clearSecret, setClearSecret] = useState(false);
  const [testAfter, setTestAfter] = useState(true);
  const [touched, setTouched] = useState(false);

  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = "请填写渠道名称。";
  for (const field of kind.fields) {
    const value = values[field.key] ?? "";
    // A blank secret on edit keeps the stored value, so only new values are checked.
    if (!value.trim()) {
      if (field.required && !editing) errors[field.key] = `请填写${field.label}。`;
      continue;
    }
    const message = field.validate?.(value);
    if (message) errors[field.key] = message;
  }
  const valid = Object.keys(errors).length === 0;

  const save = useMutation({
    mutationFn: async () => {
      const settings: Record<string, string> = {};
      for (const field of kind.fields) {
        const value = (values[field.key] ?? "").trim();
        if (value) settings[field.key] = value;
      }
      if (editing && clearSecret) settings.clearSecret = "true";
      const channel = editing
        ? await updateChannel(organizationId, state.channel.id, {
            name: name.trim(),
            settings: Object.keys(settings).length ? settings : undefined,
          })
        : await createChannel(organizationId, {
            name: name.trim(),
            kind: kind.id as StoredChannelKind,
            settings,
          });
      if (!testAfter) return `已保存渠道「${channel.name}」。`;
      const result = await testChannel(organizationId, channel.id);
      return result.delivered
        ? `已保存渠道「${channel.name}」，测试消息已送达。`
        : `已保存渠道「${channel.name}」，但测试消息发送失败：${deliveryErrorText(result.errorCode)}。`;
    },
    onSuccess: onSaved,
  });
  const serverMessage =
    save.error instanceof HTTPError && save.error.status === 400
      ? "配置无效：请确认地址是公网 HTTPS 地址，且类型与渠道匹配。"
      : save.error instanceof HTTPError && save.error.status === 409
        ? "已有同名渠道，请换一个名称。"
        : save.error instanceof HTTPError && save.error.code === "MANAGED_SECRETS_REQUIRED"
          ? "实例还没有配置主密钥，无法保存渠道密钥。请联系实例管理员设置 OPENRUM_MASTER_KEY。"
          : save.error
            ? "保存失败，请稍后重试。"
            : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChannelKindIcon kind={kind.id} size="sm" />
            {editing ? `编辑${kind.name}渠道` : `添加${kind.name}渠道`}
          </DialogTitle>
          <DialogDescription>
            {kind.id === "feishu"
              ? "告警会以卡片消息发到飞书群，卡片里带「进入诊断」按钮。"
              : "告警会以签名 JSON 发到你的 HTTPS 服务。"}
            {kind.docsSlug ? (
              <>
                {" "}
                <a
                  className="inline-flex items-center gap-0.5 underline underline-offset-4"
                  href={docsUrl(kind.docsSlug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看接入说明
                  <ExternalLinkIcon className="size-3" />
                </a>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (valid) save.mutate();
          }}
        >
          <Field data-invalid={touched && Boolean(errors.name)}>
            <FieldLabel htmlFor={`${id}-name`}>名称</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              aria-invalid={touched && Boolean(errors.name)}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription>
              在告警规则里选择渠道时显示，比如「飞书·前端值班群」。
            </FieldDescription>
            {touched && errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>
          {kind.fields.map((field) => {
            const invalid = touched && Boolean(errors[field.key]);
            const keepsStored = editing && field.secret;
            return (
              <Field key={field.key} data-invalid={invalid}>
                <FieldLabel htmlFor={`${id}-${field.key}`}>
                  {field.label}
                  {!field.required ? (
                    <span className="font-normal text-muted-foreground">（可选）</span>
                  ) : null}
                </FieldLabel>
                <Input
                  id={`${id}-${field.key}`}
                  type={field.secret && field.key !== "webhookUrl" ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={field.maxLength}
                  value={values[field.key] ?? ""}
                  placeholder={keepsStored ? "已设置，留空则不修改" : field.placeholder}
                  aria-invalid={invalid}
                  disabled={field.key === "secret" && clearSecret}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
                {field.description ? (
                  <FieldDescription>{field.description}</FieldDescription>
                ) : null}
                {invalid ? <FieldError>{errors[field.key]}</FieldError> : null}
              </Field>
            );
          })}
          {editing && kind.id === "feishu" ? (
            <Field orientation="horizontal">
              <Switch id={`${id}-clear`} checked={clearSecret} onCheckedChange={setClearSecret} />
              <FieldLabel htmlFor={`${id}-clear`} className="font-normal">
                不再使用签名校验
              </FieldLabel>
            </Field>
          ) : null}
          <Field orientation="horizontal">
            <Switch id={`${id}-test`} checked={testAfter} onCheckedChange={setTestAfter} />
            <FieldLabel htmlFor={`${id}-test`} className="font-normal">
              保存后发送一条测试消息
            </FieldLabel>
          </Field>
          {serverMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {serverMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
              ) : null}
              {editing ? "保存修改" : "保存渠道"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
