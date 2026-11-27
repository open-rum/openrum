import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { passwordPattern, passwordRuleHint, passwordRuleMessage } from "@/lib/auth/password";
import { confirmPasswordReset } from "@/lib/auth/passwordReset";
import { HTTPError } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";

export function ResetPasswordRoutePage() {
  const { token } = useParams({ from: "/reset-password/$token" });
  return <ResetPasswordPage token={token} />;
}

export function ResetPasswordPage({ token, onSuccess }: { token: string; onSuccess?: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: (password: string) => confirmPasswordReset({ token, password }),
    onSuccess: () => {
      if (onSuccess) {
        onSuccess();
        return;
      }
      window.location.replace("/login?reset=1");
    },
  });

  const invalidLink =
    confirm.error instanceof HTTPError &&
    (confirm.error.status === 410 || confirm.error.code === "PASSWORD_RESET_INVALID");

  return (
    <AuthFrame>
      <div className="auth-heading">
        <h1>设置新密码</h1>
        <p>设置完成后，该账号在其他设备上的登录会话将自动退出。</p>
      </div>

      <form
        aria-label="设置新密码"
        aria-busy={confirm.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const password = String(form.get("password") ?? "");
          const confirmPassword = String(form.get("confirmPassword") ?? "");
          const message =
            password !== confirmPassword ? "两次输入的密码不一致。" : passwordRuleMessage(password);
          setProblem(message);
          if (message) return;
          confirm.mutate(password);
        }}
      >
        <FieldGroup>
          <AuthField
            name="password"
            label="新密码"
            type="password"
            required
            maxLength={1024}
            pattern={passwordPattern}
            title={passwordRuleHint}
            autoComplete="new-password"
            autoFocus
            hint={passwordRuleHint}
          />
          <AuthField
            name="confirmPassword"
            label="确认新密码"
            type="password"
            required
            maxLength={1024}
            autoComplete="new-password"
          />

          {problem || confirm.error ? (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>
                {problem ?? resetErrorMessage(confirm.error!)}
                {invalidLink ? (
                  <>
                    {" "}
                    <a className="underline underline-offset-2" href="/forgot-password">
                      重新申请重置链接
                    </a>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={confirm.isPending}>
            {confirm.isPending ? "正在保存…" : "确认重置密码"}
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-6 text-center text-sm text-base-content/70">
        <a className="text-base-content underline underline-offset-2" href="/login">
          返回登录
        </a>
      </p>
    </AuthFrame>
  );
}

function resetErrorMessage(error: Error) {
  if (error instanceof HTTPError) {
    if (error.status === 410 || error.code === "PASSWORD_RESET_INVALID") {
      return "该密码重置链接无效或已过期。";
    }
    if (error.status === 429 || error.code === "RATE_LIMITED") {
      return "当前网络地址请求过于频繁，请稍后再试。";
    }
  }
  return error.message;
}
