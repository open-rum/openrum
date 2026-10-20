import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resendVerification, verifyEmail } from "@/lib/auth/registration";
import { HTTPError } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";

/**
 * Where the mailed link lands. Opening it confirms the address, approves the account and
 * signs it in. The page does this itself with a POST, once, so a mail scanner that only
 * fetches the page cannot use the link up.
 */
export function VerifyEmailPage() {
  const { token } = useParams({ from: "/verify-email/$token" });
  const started = useRef(false);
  const verify = useMutation({
    mutationFn: () => verifyEmail(token),
    // A full load, so the new session is read from scratch.
    onSuccess: () => window.location.replace("/"),
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    verify.mutate();
    // The token is fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resend = useMutation({ mutationFn: (email: string) => resendVerification(email) });

  if (verify.error) {
    const invalid = verify.error instanceof HTTPError && verify.error.status === 410;
    return (
      <AuthFrame>
        <div className="auth-heading">
          <h1>{invalid ? "这个验证链接已失效" : "无法完成验证"}</h1>
          <p>
            {invalid
              ? "链接可能已经用过、已过期，或者被新的链接取代。输入注册时的邮箱，重新发一封。"
              : "请稍后刷新页面重试。"}
          </p>
        </div>
        {invalid ? (
          <form
            aria-label="重新发送验证邮件"
            onSubmit={(event) => {
              event.preventDefault();
              resend.mutate(String(new FormData(event.currentTarget).get("email") ?? ""));
            }}
          >
            <AuthField
              name="email"
              label="邮箱"
              type="email"
              required
              maxLength={320}
              autoComplete="email"
            />
            {resend.isSuccess ? (
              <p className="mt-3 text-sm" role="status">
                如果这个邮箱还没有验证，新的链接已经发出。
              </p>
            ) : null}
            {resend.error ? (
              <Alert variant="destructive" className="mt-3" role="alert">
                <AlertDescription>{resend.error.message}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="mt-4 h-11 w-full"
              disabled={resend.isPending}
            >
              重新发送验证邮件
            </Button>
          </form>
        ) : null}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <a className="text-foreground underline underline-offset-2" href="/login">
            去登录
          </a>
        </p>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <p className="text-center text-sm text-muted-foreground" role="status">
        正在验证邮箱…
      </p>
    </AuthFrame>
  );
}
