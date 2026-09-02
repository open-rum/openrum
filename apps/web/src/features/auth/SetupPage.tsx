import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { bootstrap, HTTPError, sessionQueryOptions } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";

export function SetupPage() {
  const queryClient = useQueryClient();
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [clientError, setClientError] = useState("");
  const setup = useMutation({
    mutationFn: bootstrap,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
      await queryClient.fetchQuery(sessionQueryOptions());
      window.location.replace("/");
    },
  });

  return (
    <AuthFrame>
      <div className="mb-8">
        <span className="mb-5 grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
          <CheckCircle className="size-6" weight="fill" />
        </span>
        <h2 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">
          初始化 OpenRUM
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          创建首个本地 Owner 和组织。初始化完成后，该入口将永久关闭。
        </p>
      </div>

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setClientError("");
          const form = new FormData(event.currentTarget);
          const password = String(form.get("password") ?? "");
          if (password !== passwordConfirmation) {
            setClientError("两次输入的密码不一致。");
            return;
          }
          setup.mutate({
            email: String(form.get("email") ?? ""),
            displayName: String(form.get("displayName") ?? ""),
            password,
            organizationName: String(form.get("organizationName") ?? ""),
            bootstrapToken: String(form.get("bootstrapToken") ?? "") || undefined,
          });
        }}
      >
        <AuthField
          name="organizationName"
          label="组织名称"
          placeholder="例如：前端平台团队"
          required
          maxLength={120}
          autoFocus
        />
        <AuthField
          name="displayName"
          label="你的名称"
          placeholder="例如：李杰"
          required
          maxLength={120}
          autoComplete="name"
        />
        <AuthField
          name="email"
          label="工作邮箱"
          type="email"
          placeholder="you@company.com"
          required
          maxLength={320}
          autoComplete="email"
        />
        <AuthField
          name="password"
          label="密码"
          hint="至少 12 个字符"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
        <AuthField
          label="确认密码"
          type="password"
          required
          minLength={12}
          value={passwordConfirmation}
          autoComplete="new-password"
          onChange={(event) => setPasswordConfirmation(event.target.value)}
        />
        <AuthField
          name="bootstrapToken"
          label="Bootstrap Token"
          hint="如服务端已配置"
          type="password"
          autoComplete="off"
        />

        {clientError || setup.error ? (
          <p
            className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            role="alert"
          >
            {clientError || (setup.error ? errorMessage(setup.error) : "")}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="h-11 w-full" disabled={setup.isPending}>
          {setup.isPending ? "正在初始化…" : "创建实例并进入控制台"}
          {!setup.isPending ? <ArrowRight weight="bold" /> : null}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-muted-foreground">
        实例已经初始化？
        <Link
          className="ml-1 font-medium text-primary hover:underline"
          to="/login"
          search={{ returnTo: undefined, expired: undefined }}
        >
          前往登录
        </Link>
      </p>
    </AuthFrame>
  );
}

function errorMessage(error: Error) {
  if (error instanceof HTTPError && error.status === 409) return "实例已经完成初始化，请直接登录。";
  return error.message;
}
