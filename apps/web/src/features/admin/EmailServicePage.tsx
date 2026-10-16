import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  LockKeyholeIcon,
  MailIcon,
  PencilIcon,
  SendIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HTTPError } from "@/lib/auth/session";
import {
  deleteManagedEmail,
  emailDeliveryResultSchema,
  emailStatusQueryOptions,
  putManagedEmail,
  testEmail,
  type EmailDeliveryResult,
  type EmailSecurity,
  type EmailStatus,
} from "@/lib/api/admin";
import { AdminPageLayout } from "./AdminPageLayout";
import { ReauthenticationDialog } from "./ReauthenticationDialog";

const securityOptions: Record<EmailSecurity, { label: string; port: number; description: string }> =
  {
    starttls: {
      label: "STARTTLS（推荐）",
      port: 587,
      description: "先建立普通连接，再升级为加密连接。多数邮件服务商的提交端口是 587。",
    },
    tls: {
      label: "TLS / SSL（SMTPS）",
      port: 465,
      description: "连接一开始就加密。常见端口是 465。",
    },
    none: {
      label: "不加密",
      port: 25,
      description: "只用于你信任的内网中继；不加密时不能填写用户名和密码。",
    },
  };

const sourceLabels: Record<EmailStatus["source"], string> = {
  none: "未配置",
  deployment: "部署环境（SMTP_* 环境变量）",
  managed: "控制台托管 · 加密保存",
};

const stageLabels: Record<NonNullable<EmailDeliveryResult["stage"]>, string> = {
  connect: "无法连接到邮件服务器，请检查地址、端口和网络出口。",
  tls: "加密连接失败。请检查加密方式与端口是否匹配，以及服务器证书是否可信。",
  auth: "用户名或密码被服务器拒绝。多数服务商需要专用的 SMTP 密码或授权码，而不是登录密码。",
  sender: "服务器拒绝了发件人地址。发件人通常必须属于已验证的域名或与账号一致。",
  recipient: "服务器拒绝了收件人地址。",
  send: "邮件内容在发送阶段被拒绝或中断。",
};

export function EmailServicePage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(emailStatusQueryOptions());

  return (
    <AdminPageLayout
      title="邮件服务"
      description="实例用来发送邮件的 SMTP 服务器。告警邮件、成员邀请等功能都会使用它；不配置也不影响核心监控。"
    >
      {statusQuery.isLoading ? <AsyncLoading /> : null}
      {statusQuery.error ? (
        <AsyncError
          error={statusQuery.error}
          title="无法读取邮件服务状态"
          remediation="检查实例管理员权限和 API 服务。"
          onRetry={() => void statusQuery.refetch()}
        />
      ) : null}
      {statusQuery.data ? (
        <EmailContent
          email={statusQuery.data}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["admin", "email"] })}
        />
      ) : null}
    </AdminPageLayout>
  );
}

function EmailContent({ email, onChanged }: { email: EmailStatus; onChanged: () => void }) {
  // A configured instance leads with what is in effect; the form opens only to replace it.
  const [editing, setEditing] = useState(false);
  const [lastResult, setLastResult] = useState<EmailDeliveryResult>();
  const [removing, setRemoving] = useState(false);
  const test = useMutation({ mutationFn: testEmail, onSuccess: setLastResult });
  const showForm = !email.locked && (!email.configured || editing);

  return (
    <div className="flex flex-col gap-5">
      {email.configured ? (
        <EmailOverview
          email={email}
          result={lastResult}
          testing={test.isPending}
          testError={test.error}
          editing={editing}
          onTest={() => test.mutate()}
          onEdit={() => setEditing(true)}
          onRemove={() => setRemoving(true)}
        />
      ) : (
        <Alert>
          <MailIcon />
          <AlertTitle>尚未配置邮件服务</AlertTitle>
          <AlertDescription>
            现有的监控、问题和告警（飞书等渠道）都可正常使用。配置后，邮件相关功能才能发送邮件。
          </AlertDescription>
        </Alert>
      )}

      {email.managedOverridden ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>控制台里保存的配置目前没有生效</AlertTitle>
          <AlertDescription>
            部署环境已经配置了 SMTP，优先级更高。去掉部署里的 SMTP_*
            设置后，控制台保存的配置会重新生效。
          </AlertDescription>
        </Alert>
      ) : null}

      {email.locked ? <DeploymentNote /> : null}

      {showForm ? (
        <EmailConfigForm
          email={email}
          onCancel={email.configured ? () => setEditing(false) : undefined}
          onSaved={() => {
            setLastResult(undefined);
            setEditing(false);
            toast.success(email.configured ? "邮件服务配置已更新" : "邮件服务已启用", {
              description: "可以点击“发送测试邮件”确认收件正常。",
            });
            onChanged();
          }}
        />
      ) : null}

      {!email.locked && !email.managedSecretsAvailable && !showForm ? (
        <ManagedUnavailableNote />
      ) : null}

      <ProviderHelp />

      <ReauthenticationDialog
        open={removing}
        onOpenChange={setRemoving}
        onConfirmed={async () => {
          await deleteManagedEmail();
          setLastResult(undefined);
          toast.success("已移除控制台保存的邮件服务配置");
          onChanged();
        }}
        title="确认移除邮件服务配置"
        description="移除后，邮件相关功能将无法发送邮件，直到重新配置。"
        confirmLabel="移除配置"
      />
    </div>
  );
}

function EmailOverview({
  email,
  result,
  testing,
  testError,
  editing,
  onTest,
  onEdit,
  onRemove,
}: {
  email: EmailStatus;
  result?: EmailDeliveryResult;
  testing: boolean;
  testError: unknown;
  editing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const settings = email.settings;
  const managed = email.source === "managed";
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          当前邮件服务
          <Badge variant="outline" className="gap-1.5">
            <span className="project-status-dot" data-status="active" aria-hidden="true" />
            已启用
          </Badge>
        </CardTitle>
        <CardDescription>
          {managed
            ? "由控制台加密保存；更换后立即对所有副本生效。"
            : "由部署环境配置；控制台只读，修改请更新部署里的 SMTP_* 设置。"}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onTest} disabled={testing}>
            <SendIcon data-icon="inline-start" />
            {testing ? "发送中…" : "发送测试邮件"}
          </Button>
          {managed && !editing ? (
            <Button onClick={onEdit}>
              <PencilIcon data-icon="inline-start" />
              更换配置
            </Button>
          ) : null}
          {managed ? (
            <Button variant="outline" onClick={onRemove}>
              <Trash2Icon data-icon="inline-start" />
              移除
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {settings ? (
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="服务器" value={`${settings.host}:${settings.port}`} />
            <Fact label="加密方式" value={securityOptions[settings.security].label} />
            <Fact label="发件人" value={settings.from} />
            <Fact label="用户名" value={settings.username || "—"} />
            <Fact label="密码" value={settings.passwordSet ? "已设置" : "—"} />
            <Fact label="配置来源" value={sourceLabels[email.source]} />
          </dl>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          测试邮件只会发送到你自己的账号邮箱，不能指定其他收件人。
        </p>
        {testError ? (
          <AsyncError
            error={testError}
            title="无法发送测试邮件"
            remediation="确认当前账号权限和会话后重试；连续点击会被限制在每 5 秒一次。"
            onRetry={onTest}
          />
        ) : null}
        {result ? <DeliveryResult result={result} /> : null}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-all">{value}</dd>
    </div>
  );
}

function EmailConfigForm({
  email,
  onCancel,
  onSaved,
}: {
  email: EmailStatus;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const current = email.settings;
  const replacing = email.configured;
  const available = email.managedSecretsAvailable;
  const [host, setHost] = useState(current?.host ?? "");
  const [security, setSecurity] = useState<EmailSecurity>(current?.security ?? "starttls");
  const [port, setPort] = useState(current ? String(current.port) : "");
  const [username, setUsername] = useState(current?.username ?? "");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(current?.from ?? "");
  const [reauthenticationOpen, setReauthenticationOpen] = useState(false);
  const option = securityOptions[security];

  // A blank password keeps the stored one, but only for the same user on the same host.
  const canKeepPassword =
    replacing &&
    current?.passwordSet === true &&
    username.trim() !== "" &&
    username.trim() === current.username &&
    host.trim().toLowerCase() === current.host.toLowerCase();
  const portNumber = port.trim() === "" ? 0 : Number(port);
  const hasCredentials = username.trim() !== "" || password !== "";

  const blocker = !available
    ? "需要先在部署环境启用控制台托管，才能保存"
    : host.trim() === ""
      ? "请填写服务器地址"
      : !Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535
        ? "端口需要是 1 到 65535 之间的数字"
        : from.trim() === ""
          ? "请填写发件人地址"
          : security === "none" && hasCredentials
            ? "不加密时不能使用用户名和密码"
            : username.trim() !== "" && password === "" && !canKeepPassword
              ? "请填写密码"
              : username.trim() === "" && password !== ""
                ? "填写了密码，也需要填写用户名"
                : "";

  const save = useMutation({
    mutationFn: () =>
      putManagedEmail({
        host: host.trim(),
        port: portNumber,
        security,
        username: username.trim(),
        password,
        from: from.trim(),
      }),
    onSuccess: () => {
      setPassword("");
      onSaved();
    },
  });

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{replacing ? "更换配置" : "配置邮件服务"}</CardTitle>
        <CardDescription>
          保存前会先连接服务器并验证账号（不会发送邮件），通过后才保存。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {!available ? <ManagedUnavailableNote /> : null}

          <div className="grid gap-5 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="smtp-host">服务器地址</FieldLabel>
              <Input
                id="smtp-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
              />
              <FieldDescription>只填主机名，不要带 smtp:// 或端口。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-from">发件人</FieldLabel>
              <Input
                id="smtp-from"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="no-reply@example.com"
                autoComplete="off"
              />
              <FieldDescription>
                可以写成 OpenRUM &lt;no-reply@example.com&gt;。需要是你控制的域名，并配置好 SPF 和
                DKIM。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-security">加密方式</FieldLabel>
              <Select
                value={security}
                onValueChange={(value) => {
                  setSecurity(value as EmailSecurity);
                  save.reset();
                }}
              >
                <SelectTrigger id="smtp-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(Object.entries(securityOptions) as Array<[EmailSecurity, typeof option]>).map(
                      ([value, item]) => (
                        <SelectItem key={value} value={value}>
                          {item.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{option.description}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-port">端口（可选）</FieldLabel>
              <Input
                id="smtp-port"
                value={port}
                onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
                placeholder={String(option.port)}
                inputMode="numeric"
              />
              <FieldDescription>留空使用 {option.port}。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-username">用户名（可选）</FieldLabel>
              <Input
                id="smtp-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
              />
              <FieldDescription>内网中继不需要认证时可以留空。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-password">密码</FieldLabel>
              <Input
                id="smtp-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={canKeepPassword ? "留空沿用当前密码" : undefined}
                autoComplete="new-password"
              />
              <FieldDescription>
                {canKeepPassword
                  ? "留空沿用当前密码；填写则替换。"
                  : "加密保存，保存后不会再次显示。多数服务商需要专用的 SMTP 密码或授权码。"}
              </FieldDescription>
            </Field>
          </div>

          {save.error ? <SaveError error={save.error} /> : null}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs leading-5 text-muted-foreground">
          {blocker || "保存需要重新验证 Instance Owner 身份，并写入审计日志。"}
        </p>
        <div className="flex gap-2">
          {onCancel ? (
            <Button variant="outline" onClick={onCancel} disabled={save.isPending}>
              取消
            </Button>
          ) : null}
          <Button
            onClick={() => setReauthenticationOpen(true)}
            disabled={save.isPending || blocker !== ""}
          >
            <ShieldCheckIcon data-icon="inline-start" />
            {save.isPending ? "正在连接并保存…" : "验证连接并保存"}
          </Button>
        </div>
      </CardFooter>
      <ReauthenticationDialog
        open={reauthenticationOpen}
        onOpenChange={setReauthenticationOpen}
        onConfirmed={() => save.mutateAsync()}
        title={replacing ? "确认更换邮件服务配置" : "确认保存邮件服务配置"}
        description="系统会先连接服务器并验证账号，通过后才保存。这一步不会发送邮件。"
        confirmLabel="验证并应用配置"
        confirmVariant="default"
      />
    </Card>
  );
}

/** A failed save carries the delivery stage (422) or a plain API error. */
function SaveError({ error }: { error: unknown }) {
  const result =
    error instanceof HTTPError && error.status === 422
      ? emailDeliveryResultSchema.safeParse(error.body).data
      : undefined;
  if (result) return <DeliveryResult result={result} />;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>保存失败，当前配置未改变</AlertTitle>
      <AlertDescription>{error instanceof Error ? error.message : "请稍后重试。"}</AlertDescription>
    </Alert>
  );
}

function DeliveryResult({ result }: { result: EmailDeliveryResult }) {
  if (result.success) {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>测试邮件已发出</AlertTitle>
        <AlertDescription>
          已发送到 {result.recipient ?? "你的账号邮箱"}
          。邮件通常几秒内到达；没收到时请查看垃圾邮件箱。
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{result.stage ? "邮件服务验证失败" : "测试失败"}</AlertTitle>
      <AlertDescription>
        <p>{result.stage ? stageLabels[result.stage] : "请检查配置后重试。"}</p>
        {result.message ? (
          <p className="mt-2">
            服务器返回：<code className="break-all">{result.message}</code>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function DeploymentNote() {
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      要修改，请更新部署里的 <code>SMTP_HOST</code>、<code>SMTP_PORT</code>、
      <code>SMTP_SECURITY</code>、<code>SMTP_USERNAME</code>、<code>SMTP_PASSWORD</code>、
      <code>SMTP_FROM</code>（Helm 用户修改 values 并把密码放进运行时 Secret），然后重启服务。
    </p>
  );
}

function ManagedUnavailableNote() {
  return (
    <Alert>
      <LockKeyholeIcon />
      <AlertTitle>控制台托管尚未启用</AlertTitle>
      <AlertDescription>
        在部署环境设置 OPENRUM_ALLOW_MANAGED_SECRETS=true 与 32 字节 Base64 的 OPENRUM_MASTER_KEY
        后，才能在这里保存配置。也可以直接在部署环境设置 SMTP_* 变量，不需要托管。
      </AlertDescription>
    </Alert>
  );
}

const providers: Array<{ name: string; host: string; port: string; note: string }> = [
  {
    name: "腾讯企业邮箱",
    host: "smtp.exmail.qq.com",
    port: "465 · TLS",
    note: "使用邮箱地址和客户端专用密码",
  },
  {
    name: "阿里企业邮箱",
    host: "smtp.qiye.aliyun.com",
    port: "465 · TLS",
    note: "使用邮箱地址和密码",
  },
  {
    name: "Resend",
    host: "smtp.resend.com",
    port: "465 · TLS",
    note: "用户名 resend，密码为 API Key",
  },
  {
    name: "SendGrid",
    host: "smtp.sendgrid.net",
    port: "587 · STARTTLS",
    note: "用户名 apikey，密码为 API Key",
  },
  {
    name: "Amazon SES",
    host: "email-smtp.<区域>.amazonaws.com",
    port: "587 · STARTTLS",
    note: "使用 SES 生成的 SMTP 凭据",
  },
  {
    name: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: "587 · STARTTLS",
    note: "需要应用专用密码",
  },
];

function ProviderHelp() {
  return (
    <details className="group rounded-[var(--radius-surface)] border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium">
        <span>
          常见服务商参数
          <span className="ml-2 font-normal text-muted-foreground">具体以服务商文档为准</span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="overflow-x-auto border-t border-border px-5 py-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">服务商</th>
              <th className="py-2 pr-4 font-medium">服务器</th>
              <th className="py-2 pr-4 font-medium">端口 · 加密</th>
              <th className="py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.name} className="border-t border-border">
                <td className="py-2 pr-4 font-medium">{provider.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{provider.host}</td>
                <td className="py-2 pr-4">{provider.port}</td>
                <td className="py-2 text-muted-foreground">{provider.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          验证码、告警这类系统邮件建议使用事务邮件服务（如上面的
          Resend、SendGrid、SES），并为发件域名配置 SPF、DKIM 和 DMARC，否则邮件容易进入垃圾箱。
        </p>
      </div>
    </details>
  );
}
