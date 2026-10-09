import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { KeyRoundIcon, Link2Icon, UserRoundIcon } from "lucide-react";

import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword, sessionQueryOptions } from "@/lib/auth/session";
import {
  getAuthMethods,
  getLinkedIdentities,
  linkLDAP,
  setInitialPassword,
  startOAuthLink,
  unlinkIdentity,
  type AuthMethod,
} from "@/lib/auth/providers";

export function AccountPage() {
  const { data: user } = useSuspenseQuery(sessionQueryOptions());
  const queryClient = useQueryClient();
  const methods = useQuery({
    queryKey: ["auth", "methods"],
    queryFn: ({ signal }) => getAuthMethods(signal),
  });
  const linked = useQuery({
    queryKey: ["auth", "identities"],
    queryFn: ({ signal }) => getLinkedIdentities(signal),
  });
  const [ldapMethod, setLDAPMethod] = useState<AuthMethod | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const oauthLink = useMutation({
    mutationFn: startOAuthLink,
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const ldapLink = useMutation({
    mutationFn: ({ id, username, password }: { id: string; username: string; password: string }) =>
      linkLDAP(id, username, password),
    onSuccess: async () => {
      setLDAPMethod(null);
      setLinkMessage("目录身份已连接。");
      await queryClient.invalidateQueries({ queryKey: ["auth", "identities"] });
    },
  });
  const unlink = useMutation({
    mutationFn: unlinkIdentity,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "identities"] });
    },
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const password = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      formRef.current?.reset();
      setValidationError(null);
      setMessage("密码已更新，其他登录会话已退出。");
    },
  });
  const initialPassword = useMutation({
    mutationFn: setInitialPassword,
    onSuccess: async () => {
      formRef.current?.reset();
      setValidationError(null);
      setMessage("OpenRUM 密码已设置。现在可用于本地登录及管理员敏感操作。");
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });
  const hasPassword = user.hasPassword !== false;

  return (
    <ConsolePage width="narrow">
      <ConsolePageHeader title="Account" description="查看个人信息并管理登录安全。" />

      <section
        className="rounded-2xl border border-border bg-card p-6"
        aria-labelledby="profile-title"
      >
        <div className="flex items-center gap-2">
          <UserRoundIcon className="size-5 text-primary" aria-hidden="true" />
          <h2 id="profile-title" className="text-base font-semibold">
            用户信息
          </h2>
        </div>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">用户名</dt>
            <dd className="mt-1 text-sm text-foreground">{user.displayName}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">邮箱</dt>
            <dd className="mt-1 text-sm text-foreground">{user.email}</dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-2xl border border-border bg-card p-6"
        aria-labelledby="linked-methods-title"
      >
        <div className="flex items-center gap-2">
          <Link2Icon className="size-5 text-primary" aria-hidden="true" />
          <h2 id="linked-methods-title" className="text-base font-semibold">
            已连接的登录方式
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          外部身份须在此主动绑定；相同邮箱不会自动合并账号。
        </p>
        {new URLSearchParams(window.location.search).get("link") === "success" ? (
          <p className="mt-3 text-sm text-(--ds-success)" role="status">
            身份已连接。
          </p>
        ) : null}
        {new URLSearchParams(window.location.search).get("link") === "failed" ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            连接失败。请确认该外部身份尚未绑定其他账号。
          </p>
        ) : null}
        {new URLSearchParams(window.location.search).get("link") === "cancelled" ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            已取消身份连接。
          </p>
        ) : null}
        {new URLSearchParams(window.location.search).get("link") === "expired" ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            身份连接已过期，请重新开始。
          </p>
        ) : null}
        {linkMessage ? (
          <p className="mt-3 text-sm text-(--ds-success)" role="status">
            {linkMessage}
          </p>
        ) : null}
        <div className="mt-4 space-y-2">
          {hasPassword ? (
            <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
              <span>邮箱与 OpenRUM 密码</span>
              <span className="text-muted-foreground">已启用</span>
            </div>
          ) : null}
          {linked.data?.identities.map((identity) => (
            <div
              key={identity.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm"
            >
              <span>{identity.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={unlink.isPending}
                onClick={() => {
                  if (window.confirm(`解除 ${identity.label} 登录方式？`))
                    unlink.mutate(identity.id);
                }}
              >
                解除连接
              </Button>
            </div>
          ))}
        </div>
        {linked.error || methods.error || unlink.error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            无法读取或更新登录方式，请重试。
          </p>
        ) : null}
        {methods.data?.providers.some(
          (method) =>
            !linked.data?.identities.some((identity) => identity.providerId === method.id),
        ) ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {methods.data.providers
              .filter(
                (method) =>
                  !linked.data?.identities.some((identity) => identity.providerId === method.id),
              )
              .map((method) => (
                <Button
                  key={method.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={oauthLink.isPending}
                  onClick={() => {
                    if (method.kind === "ldap") setLDAPMethod(method);
                    else oauthLink.mutate(method.id);
                  }}
                >
                  连接 {method.label}
                </Button>
              ))}
          </div>
        ) : null}
        {oauthLink.error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            无法开始身份绑定，请重试。
          </p>
        ) : null}
        {ldapMethod ? (
          <form
            className="mt-4 grid gap-3 rounded-xl border border-border p-4"
            aria-label={`连接 ${ldapMethod.label}`}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              ldapLink.mutate({
                id: ldapMethod.id,
                username: String(data.get("username") ?? ""),
                password: String(data.get("password") ?? ""),
              });
            }}
          >
            <label className="grid gap-1 text-sm">
              目录用户名
              <Input name="username" autoComplete="username" required />
            </label>
            <label className="grid gap-1 text-sm">
              目录密码
              <Input name="password" type="password" autoComplete="current-password" required />
            </label>
            {ldapLink.error ? (
              <p className="text-sm text-destructive" role="alert">
                目录身份连接失败，请检查账号及邮箱。
              </p>
            ) : null}
            <Button type="submit" disabled={ldapLink.isPending}>
              {ldapLink.isPending ? "连接中…" : "确认连接"}
            </Button>
          </form>
        ) : null}
      </section>

      <form
        ref={formRef}
        className="rounded-2xl border border-border bg-card p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          setValidationError(null);
          const form = new FormData(event.currentTarget);
          const currentPassword = String(form.get("currentPassword") ?? "");
          const newPassword = String(form.get("newPassword") ?? "");
          const confirmPassword = String(form.get("confirmPassword") ?? "");
          if (newPassword !== confirmPassword) {
            setValidationError("两次输入的新密码不一致。");
            return;
          }
          if (hasPassword) password.mutate({ currentPassword, newPassword });
          else initialPassword.mutate(newPassword);
        }}
        aria-labelledby="password-title"
      >
        <div className="flex items-center gap-2">
          <KeyRoundIcon className="size-5 text-primary" aria-hidden="true" />
          <h2 id="password-title" className="text-base font-semibold">
            {hasPassword ? "修改密码" : "设置 OpenRUM 密码"}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          至少 12 个字符。外部账号须在登录后五分钟内设置，供本地登录及管理员敏感操作使用。
        </p>

        <div className="mt-5 grid gap-4">
          {hasPassword ? (
            <label className="grid gap-2 text-sm font-medium">
              当前密码
              <Input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          ) : null}
          <label className="grid gap-2 text-sm font-medium">
            新密码
            <Input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            确认新密码
            <Input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
        </div>

        {validationError || password.error || initialPassword.error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {validationError ?? password.error?.message ?? initialPassword.error?.message}
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 text-sm text-(--ds-success)" role="status">
            {message}
          </p>
        ) : null}
        <Button
          className="mt-5"
          type="submit"
          disabled={password.isPending || initialPassword.isPending}
        >
          {password.isPending || initialPassword.isPending
            ? "正在更新…"
            : hasPassword
              ? "更新密码"
              : "设置密码"}
        </Button>
      </form>
    </ConsolePage>
  );
}
