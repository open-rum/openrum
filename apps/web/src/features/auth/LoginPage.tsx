import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ArrowRight, LockKey } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
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

  return (
    <AuthFrame>
      <div className="mb-8">
        <span className="mb-5 grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
          <LockKey className="size-6" weight="fill" />
        </span>
        <h2 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">登录 OpenRUM</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          使用本地管理员账号进入前端监控控制台。
        </p>
      </div>

      {expired ? (
        <p
          className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          role="status"
        >
          登录已过期，请重新登录。完成后会返回刚才的页面。
        </p>
      ) : null}

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          authenticate.mutate({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          });
        }}
      >
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
        <AuthField
          name="password"
          label="密码"
          type="password"
          required
          minLength={12}
          autoComplete="current-password"
        />

        {authenticate.error ? (
          <p
            className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            role="alert"
          >
            {loginErrorMessage(authenticate.error)}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="h-11 w-full" disabled={authenticate.isPending}>
          {authenticate.isPending ? "正在登录…" : "登录控制台"}
          {!authenticate.isPending ? <ArrowRight weight="bold" /> : null}
        </Button>
      </form>
    </AuthFrame>
  );
}

function loginErrorMessage(error: Error) {
  if (error instanceof HTTPError && error.status === 401) return "邮箱或密码不正确。";
  if (error instanceof HTTPError && error.status === 429) return "尝试次数过多，请 15 分钟后再试。";
  return error.message;
}
