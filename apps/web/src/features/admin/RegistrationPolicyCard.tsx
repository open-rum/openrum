import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  adminRegistrationQueryKey,
  getAdminRegistration,
  registrationStatusQueryKey,
  setAdminRegistration,
} from "@/lib/auth/registration";
import { ReauthenticationDialog } from "./ReauthenticationDialog";

/**
 * Whether anyone may create an account on this instance. Closed is the default and the safe
 * choice for an instance reachable from outside; open fits a company network where signing up
 * should be enough to start. Changing it asks for the Owner's password again.
 */
export function RegistrationPolicyCard({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: adminRegistrationQueryKey,
    queryFn: ({ signal }) => getAdminRegistration(signal),
    retry: false,
  });
  const [target, setTarget] = useState<boolean | null>(null);
  const save = useMutation({
    mutationFn: (open: boolean) => setAdminRegistration(open),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminRegistrationQueryKey }),
        queryClient.invalidateQueries({ queryKey: registrationStatusQueryKey }),
      ]);
    },
  });
  if (!query.data) return null;
  const { open, mailConfigured } = query.data;

  return (
    <section
      className="mb-5 rounded-2xl border border-border bg-card p-5"
      aria-labelledby="registration-policy-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="registration-policy-title"
            className="flex items-center gap-2 text-base font-semibold"
          >
            开放注册
            <Badge variant={open ? "brand" : "outline"}>{open ? "已开放" : "仅受邀"}</Badge>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            开放后，任何人都能在 /register
            创建账号，注册完成就能建立自己的组织和项目，不需要管理员审批。
            关闭时，新账号只能通过邀请链接或外部登录产生，并且需要管理员通过。
          </p>
        </div>
        <Switch
          aria-label="开放注册"
          checked={open}
          disabled={!canEdit || save.isPending}
          onCheckedChange={(next) => setTarget(next)}
        />
      </div>
      <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        <li>
          邮箱注册：必须点开邮件里的链接验证邮箱。
          {mailConfigured ? (
            " 邮件服务已配置。"
          ) : (
            <>
              {" "}
              尚未配置邮件服务，邮箱注册不可用，请先到{" "}
              <a
                className="text-foreground underline underline-offset-2"
                href="/settings/instance/email"
              >
                邮件服务
              </a>{" "}
              设置。
            </>
          )}
        </li>
        <li>
          外部登录注册：使用已启用的 Google、GitHub 或 OIDC
          登录；没有邮箱的账号会被要求补填，不再单独验证。
        </li>
        <li>密码规则：至少 8 个字符，须同时包含大写字母、小写字母和符号。</li>
      </ul>
      {!canEdit ? (
        <p className="mt-3 text-sm text-muted-foreground">只有 Instance Owner 可以修改。</p>
      ) : null}
      {save.error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {save.error.message}
        </p>
      ) : null}
      <ReauthenticationDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title={target ? "开放注册？" : "关闭注册？"}
        description={
          target
            ? "开放后任何能访问这个实例的人都可以创建账号并建立组织。输入当前 OpenRUM 密码确认，验证有效期为五分钟。"
            : "关闭后不能再新注册，已有账号不受影响。输入当前 OpenRUM 密码确认。"
        }
        confirmVariant="default"
        onConfirmed={async () => {
          if (target !== null) await save.mutateAsync(target);
          setTarget(null);
        }}
      />
    </section>
  );
}
