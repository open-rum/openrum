import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckIcon, CircleAlertIcon, CircleIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { bootstrap, HTTPError, setupStatusQueryOptions } from "@/lib/auth/session";
import {
  passwordPattern,
  passwordRuleChecks,
  passwordRuleHint,
  passwordRuleMessage,
} from "@/lib/auth/password";
import { AuthField, AuthFrame } from "./AuthFrame";
import { AuthPasswordField } from "./AuthPasswordField";

type SetupField =
  | "organizationName"
  | "displayName"
  | "email"
  | "password"
  | "passwordConfirmation"
  | "bootstrapToken";

type ClientIssue = {
  field: SetupField;
  message: string;
};

export function SetupPage() {
  const status = useQuery(setupStatusQueryOptions());
  const bootstrapTokenRequired = Boolean(status.data?.bootstrapTokenRequired);

  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [clientIssue, setClientIssue] = useState<ClientIssue | null>(null);

  const setup = useMutation({
    mutationFn: bootstrap,
    // A full load ensures the newly issued session cookie is read from scratch.
    onSuccess: () => window.location.replace("/setup/optional"),
  });

  const checks = passwordRuleChecks(password);
  const confirmationMismatch = passwordConfirmation.length > 0 && password !== passwordConfirmation;

  const serverError = setup.error ? resolveServerError(setup.error) : null;
  const activeError = clientIssue
    ? { message: clientIssue.message, field: clientIssue.field, alreadyInitialized: false }
    : serverError;

  const isFieldInvalid = (field: SetupField) =>
    activeError?.field === field || (field === "passwordConfirmation" && confirmationMismatch);

  return (
    <AuthFrame>
      <div className="auth-heading">
        <h1>初始化 OpenRUM</h1>
        <p>创建首个实例所有者账号与默认组织。初始化完成后，此入口将自动关闭。</p>
      </div>

      <form
        aria-label="初始化 OpenRUM"
        aria-busy={setup.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          setClientIssue(null);
          setup.reset();

          const form = new FormData(event.currentTarget);
          const organizationName = String(form.get("organizationName") ?? "").trim();
          const displayName = String(form.get("displayName") ?? "").trim();
          const email = String(form.get("email") ?? "").trim();
          const bootstrapToken = String(form.get("bootstrapToken") ?? "").trim();

          if (!organizationName) {
            setClientIssue({ field: "organizationName", message: "请填写组织名称。" });
            return;
          }
          if (!displayName) {
            setClientIssue({ field: "displayName", message: "请填写管理员姓名。" });
            return;
          }
          if (!email) {
            setClientIssue({ field: "email", message: "请填写工作邮箱。" });
            return;
          }
          const weak = passwordRuleMessage(password);
          if (weak) {
            setClientIssue({ field: "password", message: weak });
            return;
          }
          if (password !== passwordConfirmation) {
            setClientIssue({ field: "passwordConfirmation", message: "两次输入的密码不一致。" });
            return;
          }
          if (bootstrapTokenRequired && !bootstrapToken) {
            setClientIssue({
              field: "bootstrapToken",
              message: "请填写服务端配置的 Bootstrap Token。",
            });
            return;
          }

          setup.mutate({
            email,
            displayName,
            password,
            organizationName,
            bootstrapToken: bootstrapTokenRequired ? bootstrapToken : undefined,
          });
        }}
      >
        <FieldGroup>
          <AuthField
            name="organizationName"
            label="组织名称"
            placeholder="例如：前端平台团队"
            required
            maxLength={120}
            autoFocus
            aria-invalid={isFieldInvalid("organizationName") || undefined}
            aria-describedby={activeError?.field === "organizationName" ? "setup-error" : undefined}
            onChange={() => {
              if (clientIssue?.field === "organizationName") setClientIssue(null);
            }}
          />
          <AuthField
            name="displayName"
            label="管理员姓名"
            placeholder="例如：张明"
            required
            maxLength={120}
            autoComplete="name"
            aria-invalid={isFieldInvalid("displayName") || undefined}
            aria-describedby={activeError?.field === "displayName" ? "setup-error" : undefined}
            onChange={() => {
              if (clientIssue?.field === "displayName") setClientIssue(null);
            }}
          />
          <AuthField
            name="email"
            label="工作邮箱"
            type="email"
            placeholder="you@company.com"
            required
            maxLength={320}
            autoComplete="email"
            aria-invalid={isFieldInvalid("email") || undefined}
            aria-describedby={activeError?.field === "email" ? "setup-error" : undefined}
            onChange={() => {
              if (clientIssue?.field === "email") setClientIssue(null);
            }}
          />
          <AuthPasswordField
            name="password"
            label="密码"
            placeholder="设置管理员密码"
            required
            maxLength={1024}
            pattern={passwordPattern}
            title={passwordRuleHint}
            value={password}
            autoComplete="new-password"
            aria-invalid={isFieldInvalid("password") || undefined}
            aria-describedby={activeError?.field === "password" ? "setup-error" : undefined}
            onChange={(event) => {
              setPassword(event.target.value);
              if (
                clientIssue?.field === "password" ||
                clientIssue?.field === "passwordConfirmation"
              ) {
                setClientIssue(null);
              }
            }}
            footer={
              <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-xs" aria-label="密码要求">
                {checks.map((item) => (
                  <li
                    key={item.id}
                    className={
                      item.met
                        ? "inline-flex items-center gap-1 text-success"
                        : "inline-flex items-center gap-1 text-base-content/70"
                    }
                  >
                    {item.met ? (
                      <CheckIcon className="size-3.5" aria-hidden="true" />
                    ) : (
                      <CircleIcon className="size-3" aria-hidden="true" />
                    )}
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            }
          />
          <AuthPasswordField
            name="passwordConfirmation"
            label="确认密码"
            placeholder="再次输入密码"
            required
            maxLength={1024}
            value={passwordConfirmation}
            autoComplete="new-password"
            aria-invalid={isFieldInvalid("passwordConfirmation") || undefined}
            aria-describedby={
              activeError?.field === "passwordConfirmation" ? "setup-error" : undefined
            }
            onChange={(event) => {
              setPasswordConfirmation(event.target.value);
              if (clientIssue?.field === "passwordConfirmation") setClientIssue(null);
            }}
            footer={
              confirmationMismatch ? (
                <p className="text-xs text-error" role="status">
                  两次输入的密码不一致。
                </p>
              ) : null
            }
          />
          {bootstrapTokenRequired ? (
            <AuthPasswordField
              name="bootstrapToken"
              label="Bootstrap Token"
              placeholder="输入部署配置的初始化令牌"
              hint="请输入部署环境变量 BOOTSTRAP_TOKEN 中配置的令牌。"
              required
              autoComplete="off"
              aria-invalid={isFieldInvalid("bootstrapToken") || undefined}
              aria-describedby={activeError?.field === "bootstrapToken" ? "setup-error" : undefined}
              onChange={() => {
                if (clientIssue?.field === "bootstrapToken") setClientIssue(null);
              }}
            />
          ) : null}

          {activeError ? (
            <Alert variant="destructive" id="setup-error" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>
                {activeError.message}
                {activeError.alreadyInitialized ? (
                  <>
                    {" "}
                    <Link
                      className="underline underline-offset-2"
                      to="/login"
                      search={{ returnTo: undefined, expired: undefined }}
                    >
                      前往登录
                    </Link>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2.5 pt-1">
            <Button type="submit" size="lg" className="h-11 w-full" disabled={setup.isPending}>
              {setup.isPending ? "正在初始化…" : "创建实例并继续"}
            </Button>
            <p className="text-center text-xs leading-5 text-base-content/70">
              请妥善保存该账号密码，用于登录控制台及配置外部登录时的恢复访问。
            </p>
          </div>
        </FieldGroup>
      </form>
    </AuthFrame>
  );
}

function resolveServerError(error: Error): {
  message: string;
  field?: SetupField;
  alreadyInitialized?: boolean;
} {
  if (!(error instanceof HTTPError)) {
    return { message: "无法连接到服务，请检查网络与后端状态后重试。" };
  }
  if (error.status === 409 || error.code === "ALREADY_INITIALIZED") {
    return {
      message: "实例已完成初始化，请使用现有账号登录。",
      alreadyInitialized: true,
    };
  }
  if (error.status === 403 || error.code === "BOOTSTRAP_TOKEN_INVALID") {
    return {
      message: "Bootstrap Token 不正确，请核对部署环境变量 BOOTSTRAP_TOKEN 后重试。",
      field: "bootstrapToken",
    };
  }
  if (error.status === 400 || error.code === "VALIDATION_ERROR") {
    const lower = error.message.toLowerCase();
    if (lower.includes("email")) {
      return { message: "工作邮箱格式不正确，请重新输入。", field: "email" };
    }
    if (lower.includes("display name")) {
      return { message: "管理员姓名长度需在 1 至 120 个字符之间。", field: "displayName" };
    }
    if (lower.includes("organization")) {
      return { message: "组织名称长度需在 1 至 120 个字符之间。", field: "organizationName" };
    }
    if (lower.includes("password")) {
      return { message: passwordRuleHint, field: "password" };
    }
    return { message: "提交的信息格式有误，请检查表单内容后重试。" };
  }
  if (error.status >= 500 || error.code === "INTERNAL_ERROR") {
    return { message: "初始化未能完成，请检查服务端日志后稍后重试。" };
  }
  return { message: error.message || "请求失败，请稍后重试。" };
}
