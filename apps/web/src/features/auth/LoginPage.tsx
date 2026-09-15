import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { HTTPError, login, safeReturnTo, sessionQueryOptions } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";

type LoginPageProps = {
  returnTo?: string;
  expired?: boolean;
};

export function LoginRoutePage() {
  const search = useSearch({ from: "/login" });
  return <LoginPage returnTo={search.returnTo} expired={search.expired} />;
}

export function LoginPage({ returnTo, expired }: LoginPageProps) {
  const queryClient = useQueryClient();
  const authenticate = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(sessionQueryOptions().queryKey, user);
      window.location.replace(safeReturnTo(returnTo));
    },
  });
  const invalidCredentials =
    authenticate.error instanceof HTTPError && authenticate.error.status === 401;

  return (
    <AuthFrame>
      <div className="auth-heading">
        <h1>欢迎使用 OpenRUM</h1>
        <p>登录监控控制台</p>
      </div>

      {expired ? (
        <Alert className="mb-5" role="status">
          <AlertDescription>登录已过期，请重新登录。完成后会返回刚才的页面。</AlertDescription>
        </Alert>
      ) : null}

      <form
        aria-label="登录 OpenRUM"
        aria-busy={authenticate.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          authenticate.mutate({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          });
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
            aria-invalid={invalidCredentials || undefined}
            aria-describedby={authenticate.error ? "login-error" : undefined}
          />
          <AuthField
            name="password"
            label="密码"
            type="password"
            placeholder="输入密码"
            required
            minLength={12}
            autoComplete="current-password"
            aria-invalid={invalidCredentials || undefined}
            aria-describedby={authenticate.error ? "login-error" : undefined}
          />

          {authenticate.error ? (
            <Alert variant="destructive" id="login-error">
              <AlertDescription>{loginErrorMessage(authenticate.error)}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            variant="contrast"
            size="lg"
            className="mt-1 h-11 w-full"
            disabled={authenticate.isPending}
          >
            {authenticate.isPending ? "正在登录…" : "登录"}
          </Button>
        </FieldGroup>
      </form>
    </AuthFrame>
  );
}

function loginErrorMessage(error: Error) {
  if (error instanceof HTTPError && error.status === 401) return "邮箱或密码不正确。";
  if (error instanceof HTTPError && error.status === 429) return "尝试次数过多，请 15 分钟后再试。";
  return error.message;
}
