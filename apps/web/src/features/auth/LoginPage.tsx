import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Building2Icon, ShieldCheckIcon } from "lucide-react";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { HTTPError, login, safeReturnTo, sessionQueryOptions } from "@/lib/auth/session";
import { getAuthMethods, loginLDAP, startOAuthLogin, type AuthMethod } from "@/lib/auth/providers";
import { AuthField, AuthFrame } from "./AuthFrame";

type LoginPageProps = {
  returnTo?: string;
  expired?: boolean;
  externalError?: "external" | "cancelled" | "expired";
};

export function LoginRoutePage() {
  const search = useSearch({ from: "/login" });
  return (
    <LoginPage
      returnTo={search.returnTo}
      expired={search.expired}
      externalError={search.error as LoginPageProps["externalError"]}
    />
  );
}

export function LoginPage({ returnTo, expired, externalError }: LoginPageProps) {
  const queryClient = useQueryClient();
  const methods = useQuery({
    queryKey: ["auth", "methods"],
    queryFn: ({ signal }) => getAuthMethods(signal),
  });
  const [ldapMethod, setLDAPMethod] = useState<AuthMethod | null>(null);
  const oauth = useMutation({
    mutationFn: (providerId: string) => startOAuthLogin(providerId, safeReturnTo(returnTo)),
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const directory = useMutation({
    mutationFn: ({
      providerId,
      username,
      password,
    }: {
      providerId: string;
      username: string;
      password: string;
    }) => loginLDAP(providerId, { username, password, returnTo: safeReturnTo(returnTo) }),
    onSuccess: (user) => {
      queryClient.setQueryData(sessionQueryOptions().queryKey, user);
      window.location.replace(user.returnTo);
    },
  });
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
      {externalError ? (
        <Alert
          variant={externalError === "cancelled" ? "default" : "destructive"}
          className="mb-5"
          role="alert"
        >
          <AlertDescription>
            {externalError === "cancelled"
              ? "已取消外部授权，您可以选择其他登录方式。"
              : externalError === "expired"
                ? "外部登录已过期，请重新开始。"
                : "外部登录未完成。请重试，或先用已绑定的方式登录后到 Account 连接身份。"}
          </AlertDescription>
        </Alert>
      ) : null}

      {methods.data?.providers.length ? (
        <section className="mb-6 space-y-2" aria-label="其他登录方式">
          {methods.data.providers.map((method) => (
            <Button
              key={method.id}
              type="button"
              variant="outline"
              className="h-11 w-full justify-center"
              disabled={oauth.isPending || directory.isPending}
              onClick={() => {
                directory.reset();
                if (method.kind === "ldap") setLDAPMethod(method);
                else {
                  setLDAPMethod(null);
                  oauth.mutate(method.id);
                }
              }}
            >
              <ProviderIcon kind={method.kind} />
              使用 {method.label} 登录
            </Button>
          ))}
          {ldapMethod ? (
            <form
              className="mt-4 space-y-3 rounded-2xl border border-border bg-card p-4"
              aria-label={`${ldapMethod.label} 登录`}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                directory.mutate({
                  providerId: ldapMethod.id,
                  username: String(data.get("username") ?? ""),
                  password: String(data.get("password") ?? ""),
                });
              }}
            >
              <AuthField
                name="username"
                label="目录用户名"
                autoComplete="username"
                required
                autoFocus
              />
              <AuthField
                name="password"
                label="目录密码"
                type="password"
                autoComplete="current-password"
                required
              />
              {directory.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {loginErrorMessage(directory.error, true)}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={directory.isPending}>
                {directory.isPending ? "正在验证…" : "登录"}
              </Button>
            </form>
          ) : null}
          {oauth.error ? (
            <p className="text-sm text-destructive" role="alert">
              无法开始外部登录，请稍后重试。
            </p>
          ) : null}
        </section>
      ) : null}

      {methods.data?.providers.length ? (
        <div
          className="mb-6 flex items-center gap-3 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span className="h-px flex-1 bg-border" />
          或使用邮箱密码
          <span className="h-px flex-1 bg-border" />
        </div>
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
            autoFocus={!methods.data?.providers.length}
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

function ProviderIcon({ kind }: { kind: AuthMethod["kind"] }) {
  if (kind === "google") return <GoogleIcon className="rounded-[2px] bg-white" />;
  if (kind === "github") return <SiGithub className="size-4" aria-hidden="true" />;
  if (kind === "ldap") return <Building2Icon className="size-4" aria-hidden="true" />;
  return <ShieldCheckIcon className="size-4" aria-hidden="true" />;
}

function loginErrorMessage(error: Error, directory = false) {
  if (error instanceof HTTPError && error.status === 401)
    return directory ? "目录用户名或密码不正确。" : "邮箱或密码不正确。";
  if (error instanceof HTTPError && error.status === 429) return "尝试次数过多，请 15 分钟后再试。";
  return error.message;
}
