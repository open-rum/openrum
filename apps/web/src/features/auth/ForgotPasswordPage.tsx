import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, MailCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  getPasswordResetStatus,
  passwordResetStatusQueryKey,
  requestPasswordReset,
} from "@/lib/auth/passwordReset";
import { HTTPError } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";

export function ForgotPasswordPage() {
  const status = useQuery({
    queryKey: passwordResetStatusQueryKey,
    queryFn: ({ signal }) => getPasswordResetStatus(signal),
    retry: false,
  });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const requestReset = useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
    onSuccess: (_result, email) => setSentTo(email.trim().toLowerCase()),
  });

  if (status.isLoading) {
    return (
      <AuthFrame>
        <p className="text-center text-sm text-base-content/70" role="status">
          正在检查邮件服务状态…
        </p>
      </AuthFrame>
    );
  }

  if (sentTo) {
    return <CheckResetMail email={sentTo} />;
  }

  if (!status.data?.enabled) {
    return (
      <AuthFrame>
        <div className="auth-heading">
          <h1>找回密码</h1>
          <p>通过邮件链接重置 OpenRUM 账号密码</p>
        </div>

        <Alert variant="warning" className="mb-5" role="status">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            当前实例尚未配置邮件服务，暂不支持通过邮箱自助重置密码。
          </AlertDescription>
        </Alert>

        <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm text-base-content/85">
          <p>
            如果您是实例管理员，可在部署环境中执行以下命令直接重置账号密码。重置后，该账号的现有登录会话将自动失效：
          </p>
          <pre className="overflow-x-auto rounded-box bg-base-200 p-3 font-mono text-xs leading-5 text-base-content">
            {`# Docker Compose / 容器环境
docker compose exec api /app/api reset-password --email you@company.com

# Kubernetes
kubectl exec -it deploy/openrum-api -- /app/api reset-password --email you@company.com

# 本地源码栈
pnpm openrum reset-password --email you@company.com`}
          </pre>
          <p className="text-xs text-base-content/70">
            如果忘记了管理员邮箱，可在上述命令末尾改用 <code>--list-admins</code>{" "}
            查看当前实例管理员列表。如非实例管理员，请联系管理员协助重置密码，或先在实例设置中配置邮件服务。
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-base-content/70">
          <a className="text-base-content underline underline-offset-2" href="/login">
            返回登录
          </a>
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="auth-heading">
        <h1>找回密码</h1>
        <p>输入账号对应的邮箱地址，系统将向该邮箱发送密码重置链接。</p>
      </div>

      <form
        aria-label="申请重置密码"
        aria-busy={requestReset.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          requestReset.mutate(String(form.get("email") ?? ""));
        }}
      >
        <FieldGroup>
          <AuthField
            name="email"
            label="邮箱"
            type="email"
            placeholder="you@company.com"
            required
            maxLength={320}
            autoComplete="email"
            autoFocus
          />

          {requestReset.error ? (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{forgotPasswordErrorMessage(requestReset.error)}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="mt-1 h-11 w-full"
            disabled={requestReset.isPending}
          >
            {requestReset.isPending ? "正在发送…" : "发送重置链接"}
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-6 text-center text-sm text-base-content/70">
        想起密码了？{" "}
        <a className="text-base-content underline underline-offset-2" href="/login">
          返回登录
        </a>
      </p>
    </AuthFrame>
  );
}

function CheckResetMail({ email }: { email: string }) {
  const resend = useMutation({ mutationFn: () => requestPasswordReset(email) });
  return (
    <AuthFrame>
      <div className="space-y-5 text-center">
        <div className="auth-heading">
          <h1>请查收重置邮件</h1>
          <p>
            如果 {email} 对应一个已验证的有效账号，一封包含密码重置链接的邮件已发出。链接 1
            小时内有效，重置后原有登录会话将自动退出。
          </p>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-sm text-base-content/70">
          <MailCheckIcon className="size-4" aria-hidden="true" />
          未收到邮件时，请先检查垃圾邮件箱，稍后再重新发送。
        </p>
        {resend.isSuccess ? (
          <p className="text-sm text-base-content" role="status">
            已重新提交发送请求，请稍候查收。
          </p>
        ) : null}
        {resend.error ? (
          <p className="text-sm text-error" role="alert">
            {forgotPasswordErrorMessage(resend.error)}
          </p>
        ) : null}
        <div className="flex justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            重新发送重置邮件
          </Button>
          <Button asChild variant="ghost">
            <a href="/login">返回登录</a>
          </Button>
        </div>
      </div>
    </AuthFrame>
  );
}

function forgotPasswordErrorMessage(error: Error) {
  const code = error instanceof HTTPError ? error.code : undefined;
  if (code === "EMAIL_UNAVAILABLE") return "当前实例尚未配置邮件服务，无法发送重置邮件。";
  if (code === "EMAIL_DELIVERY_FAILED") return "重置邮件发送失败，请稍后重试或联系管理员。";
  if (code === "RATE_LIMITED") return "当前网络地址请求过于频繁，请稍后再试。";
  return error.message;
}
