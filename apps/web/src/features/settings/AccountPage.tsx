import { useRef, useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { KeyRoundIcon, UserRoundIcon } from "lucide-react";

import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword, sessionQueryOptions } from "@/lib/auth/session";

export function AccountPage() {
  const { data: user } = useSuspenseQuery(sessionQueryOptions());
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

  return (
    <ConsolePage width="narrow">
      <ConsolePageHeader title="Account" description="查看个人信息并管理登录安全。" />

      <section
        className="rounded-lg border border-border bg-card p-6"
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

      <form
        ref={formRef}
        className="rounded-lg border border-border bg-card p-6"
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
          password.mutate({ currentPassword, newPassword });
        }}
        aria-labelledby="password-title"
      >
        <div className="flex items-center gap-2">
          <KeyRoundIcon className="size-5 text-primary" aria-hidden="true" />
          <h2 id="password-title" className="text-base font-semibold">
            修改密码
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">新密码至少包含 12 个字符。</p>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-2 text-sm font-medium">
            当前密码
            <Input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
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

        {validationError || password.error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {validationError ?? password.error?.message}
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 text-sm text-(--ds-success)" role="status">
            {message}
          </p>
        ) : null}
        <Button className="mt-5" type="submit" disabled={password.isPending}>
          {password.isPending ? "正在更新…" : "更新密码"}
        </Button>
      </form>
    </ConsolePage>
  );
}
