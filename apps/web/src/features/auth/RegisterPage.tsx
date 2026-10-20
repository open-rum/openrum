import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, MailCheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { getAuthMethods, startOAuthLogin } from "@/lib/auth/providers";
import {
  getRegistrationStatus,
  registerWithEmail,
  registrationStatusQueryKey,
  resendVerification,
} from "@/lib/auth/registration";
import { passwordPattern, passwordRuleHint, passwordRuleMessage } from "@/lib/auth/password";
import { HTTPError } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";
import { ProviderIcon } from "./ProviderIcon";

/**
 * Where anyone can create an account once an administrator has opened registration: by email,
 * which must be confirmed with a mailed link, or through an external provider.
 */
export function RegisterPage() {
  const status = useQuery({
    queryKey: registrationStatusQueryKey,
    queryFn: ({ signal }) => getRegistrationStatus(signal),
    retry: false,
  });
  const methods = useQuery({
    queryKey: ["auth", "methods"],
    queryFn: ({ signal }) => getAuthMethods(signal),
  });
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (status.isLoading) {
    return (
      <AuthFrame>
        <p className="text-center text-sm text-muted-foreground" role="status">
          正在读取注册设置…
        </p>
      </AuthFrame>
    );
  }
  if (!status.data?.open) {
    return (
      <AuthFrame>
        <div className="auth-heading">
          <h1>暂未开放注册</h1>
          <p>这个实例只接受邀请。请向管理员要一个邀请链接，或直接登录。</p>
        </div>
        <p className="text-center text-sm">
          <a className="text-foreground underline underline-offset-2" href="/login">
            去登录
          </a>
        </p>
      </AuthFrame>
    );
  }
  if (sentTo) return <CheckMail email={sentTo} />;

  const providers = (methods.data?.providers ?? []).filter((method) => method.kind !== "ldap");
  const hasDirectory = (methods.data?.providers ?? []).some((method) => method.kind === "ldap");
  return (
    <AuthFrame>
      <div className="auth-heading">
        <h1>注册 OpenRUM</h1>
        <p>创建账号后就可以建立自己的组织和项目。</p>
      </div>
      {providers.length ? <ProviderButtons providers={providers} /> : null}
      {providers.length && status.data.email ? (
        <div
          className="mb-6 flex items-center gap-3 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span className="h-px flex-1 bg-border" />
          或使用邮箱
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      {status.data.email ? (
        <EmailForm onSent={setSentTo} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          邮箱注册需要管理员先配置邮件服务。{providers.length ? "现在可以用上面的方式注册。" : ""}
        </p>
      )}
      {hasDirectory ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          使用公司目录账号的人，直接登录即可，不需要注册。
        </p>
      ) : null}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <a className="text-foreground underline underline-offset-2" href="/login">
          登录
        </a>
      </p>
    </AuthFrame>
  );
}

function ProviderButtons({
  providers,
}: {
  providers: Array<{ id: string; kind: "google" | "github" | "oidc" | "ldap"; label: string }>;
}) {
  const oauth = useMutation({
    mutationFn: (providerId: string) => startOAuthLogin(providerId, "/"),
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  return (
    <section className="mb-6 space-y-2" aria-label="使用其他账号注册">
      {providers.map((method) => (
        <Button
          key={method.id}
          type="button"
          variant="outline"
          className="h-11 w-full justify-center"
          disabled={oauth.isPending}
          onClick={() => oauth.mutate(method.id)}
        >
          <ProviderIcon kind={method.kind} />
          使用 {method.label} 注册
        </Button>
      ))}
      {oauth.error ? (
        <p className="text-sm text-destructive" role="alert">
          无法开始外部注册，请稍后重试。
        </p>
      ) : null}
    </section>
  );
}

function EmailForm({ onSent }: { onSent: (email: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: registerWithEmail,
    onSuccess: (_result, input) => onSent(input.email.trim().toLowerCase()),
  });
  return (
    <form
      aria-label="使用邮箱注册"
      aria-busy={register.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") ?? "");
        const message =
          password !== String(form.get("confirmPassword") ?? "")
            ? "两次输入的密码不一致。"
            : passwordRuleMessage(password);
        setProblem(message);
        if (message) return;
        register.mutate({
          displayName: String(form.get("displayName") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
        });
      }}
    >
      <FieldGroup>
        <AuthField
          name="displayName"
          label="用户名"
          placeholder="同事看到的名字"
          required
          maxLength={120}
          autoComplete="name"
        />
        <AuthField
          name="email"
          label="邮箱"
          type="email"
          placeholder="you@company.com"
          required
          maxLength={320}
          autoComplete="email"
        />
        <AuthField
          name="password"
          label="密码"
          type="password"
          required
          maxLength={1024}
          pattern={passwordPattern}
          title={passwordRuleHint}
          autoComplete="new-password"
          hint={passwordRuleHint}
        />
        <AuthField
          name="confirmPassword"
          label="确认密码"
          type="password"
          required
          maxLength={1024}
          autoComplete="new-password"
        />
        {problem || register.error ? (
          <Alert variant="destructive" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>{problem ?? registerErrorMessage(register.error!)}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={register.isPending}>
          {register.isPending ? "正在提交…" : "注册"}
        </Button>
      </FieldGroup>
    </form>
  );
}

function CheckMail({ email }: { email: string }) {
  const resend = useMutation({ mutationFn: () => resendVerification(email) });
  return (
    <AuthFrame>
      <div className="space-y-5 text-center">
        <div className="auth-heading">
          <h1>请查收验证邮件</h1>
          <p>
            如果 {email} 可以注册，一封带验证链接的邮件已经发出。点开链接就能完成注册，链接 24
            小时内有效。已经注册过的邮箱不会收到邮件，请直接登录。
          </p>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <MailCheckIcon className="size-4" aria-hidden="true" />
          没收到？先看看垃圾邮件，再重新发送。
        </p>
        {resend.isSuccess ? (
          <p className="text-sm" role="status">
            已重新发送，请稍等片刻。
          </p>
        ) : null}
        {resend.error ? (
          <p className="text-sm text-destructive" role="alert">
            {registerErrorMessage(resend.error)}
          </p>
        ) : null}
        <div className="flex justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            重新发送验证邮件
          </Button>
          <Button asChild variant="ghost">
            <a href="/login">去登录</a>
          </Button>
        </div>
      </div>
    </AuthFrame>
  );
}

function registerErrorMessage(error: Error) {
  const code = error instanceof HTTPError ? error.code : undefined;
  if (code === "REGISTRATION_CLOSED") return "暂未开放注册。";
  if (code === "EMAIL_UNAVAILABLE") return "邮箱注册暂不可用，请联系管理员。";
  if (code === "EMAIL_DELIVERY_FAILED") return "验证邮件没能发出，请稍后重试或联系管理员。";
  if (code === "RATE_LIMITED") return "这个网络地址尝试得太频繁了，请稍后再试。";
  return error.message;
}
