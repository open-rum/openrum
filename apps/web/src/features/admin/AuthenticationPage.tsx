import { useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  disableAdminProvider,
  getAdminAuthentication,
  saveAdminProvider,
  testAdminProvider,
  type AdminAuthProvider,
  type AuthMethod,
  type ProviderSettings,
} from "@/lib/auth/providers";
import { sessionQueryOptions } from "@/lib/auth/session";
import { AdminPageLayout } from "./AdminPageLayout";
import { ReauthenticationDialog } from "./ReauthenticationDialog";

type Draft = {
  id: string;
  kind: AuthMethod["kind"];
  label: string;
  enabled: boolean;
  settings: ProviderSettings;
  secret: string;
  existing: boolean;
};

function newDraft(kind: AuthMethod["kind"] = "google"): Draft {
  return {
    id: kind === "oidc" ? "" : kind,
    kind,
    label: { google: "Google", github: "GitHub", oidc: "企业 OIDC", ldap: "企业 LDAP" }[kind],
    enabled: false,
    settings:
      kind === "ldap"
        ? {
            ldapUrl: "ldaps://",
            userFilter: "(uid={username})",
            idAttribute: "entryUUID",
            emailAttribute: "mail",
            nameAttribute: "displayName",
          }
        : {},
    secret: "",
    existing: false,
  };
}

function fromProvider(provider: AdminAuthProvider): Draft {
  return {
    id: provider.id,
    kind: provider.kind,
    label: provider.label,
    enabled: provider.enabled,
    settings: provider.settings,
    secret: "",
    existing: true,
  };
}

export function AuthenticationPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "authentication"],
    queryFn: ({ signal }) => getAdminAuthentication(signal),
  });
  const session = useQuery(sessionQueryOptions());
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [action, setAction] = useState<"save" | "disable" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: () =>
      saveAdminProvider(draft.id, {
        kind: draft.kind,
        label: draft.label,
        enabled: draft.enabled,
        settings: draft.settings,
        secret: draft.secret || undefined,
      }),
    onSuccess: async () => {
      setDraft((current) => ({ ...current, secret: "", existing: true }));
      setMessage("登录方式已保存。");
      await queryClient.invalidateQueries({ queryKey: ["admin", "authentication"] });
    },
  });
  const disable = useMutation({
    mutationFn: () => disableAdminProvider(draft.id),
    onSuccess: async () => {
      setDraft((current) => ({ ...current, enabled: false }));
      setMessage("登录方式已停用。");
      await queryClient.invalidateQueries({ queryKey: ["admin", "authentication"] });
    },
  });
  const test = useMutation({
    mutationFn: () => testAdminProvider(draft.id),
    onSuccess: (result) => {
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
      else setMessage("目录连接测试成功。请再用真实用户验证搜索过滤器。");
    },
  });

  const canEdit =
    session.data?.instanceRole === "instance_owner" && query.data?.managedSecretsAvailable;
  const currentProvider = query.data?.providers.find((provider) => provider.id === draft.id);

  return (
    <AdminPageLayout
      title="认证与访问"
      description="管理控制台登录方式。只有 Instance Owner 可以修改；本地 Owner 登录始终保留。"
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.4fr)]">
        <section className="rounded-lg border border-border bg-card p-5" aria-label="登录方式列表">
          <h2 className="text-base font-semibold">已配置方式</h2>
          <div className="mt-4 space-y-2">
            <div className="rounded-md border border-border px-3 py-3 text-sm">
              邮箱与 OpenRUM 密码 · 始终启用
            </div>
            {query.data?.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  setDraft(fromProvider(provider));
                  setMessage("");
                }}
                className="flex w-full items-center justify-between rounded-md border border-border px-3 py-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span>{provider.label}</span>
                <span className="text-xs text-muted-foreground">
                  {provider.enabled ? "已启用" : "已停用"}
                </span>
              </button>
            ))}
          </div>
          {canEdit ? (
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => {
                setDraft(newDraft());
                setMessage("");
              }}
            >
              <PlusIcon /> 添加方式
            </Button>
          ) : null}
        </section>

        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="provider-form-title"
        >
          <div className="flex items-center gap-2">
            <KeyRoundIcon className="size-5 text-primary" />
            <h2 id="provider-form-title" className="text-base font-semibold">
              配置登录方式
            </h2>
          </div>
          {!query.data?.managedSecretsAvailable ? (
            <Alert className="mt-4">
              <AlertTitle>需要启用加密托管</AlertTitle>
              <AlertDescription>
                部署时设置 OPENRUM_ALLOW_MANAGED_SECRETS=true 和 OPENRUM_MASTER_KEY，重启 API
                后才可保存外部登录密钥。
              </AlertDescription>
            </Alert>
          ) : null}
          {query.error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              无法读取认证配置，请检查 API。
            </p>
          ) : null}
          {new URLSearchParams(window.location.search).get("test") === "success" ? (
            <p className="mt-4 text-sm text-(--ds-success)" role="status">
              外部授权测试成功，未创建新账号。
            </p>
          ) : null}
          {new URLSearchParams(window.location.search).get("test") === "failed" ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              外部授权测试失败，请检查配置。
            </p>
          ) : null}
          {new URLSearchParams(window.location.search).get("test") === "cancelled" ? (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              已取消授权测试。
            </p>
          ) : null}
          {new URLSearchParams(window.location.search).get("test") === "expired" ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              授权测试已过期，请重新开始。
            </p>
          ) : null}
          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setAction("save");
            }}
          >
            <label className="grid gap-2 text-sm font-medium">
              类型
              <select
                value={draft.kind}
                disabled={draft.existing || !canEdit}
                onChange={(event) => setDraft(newDraft(event.target.value as Draft["kind"]))}
                className="h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="google">Google</option>
                <option value="github">GitHub</option>
                <option value="ldap">LDAP</option>
                <option value="oidc">通用 OIDC</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              提供者 ID
              <Input
                value={draft.id}
                disabled={draft.existing || !canEdit}
                required
                pattern="[a-z][a-z0-9-]{0,39}"
                placeholder={draft.kind === "oidc" ? "例如 company-sso" : draft.kind}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, id: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              显示名称
              <Input
                value={draft.label}
                disabled={!canEdit}
                required
                maxLength={80}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            {draft.kind === "ldap" ? (
              <LDAPFields draft={draft} setDraft={setDraft} disabled={!canEdit} />
            ) : (
              <OAuthFields draft={draft} setDraft={setDraft} disabled={!canEdit} />
            )}
            <label className="grid gap-2 text-sm font-medium">
              {draft.kind === "ldap" ? "搜索账号密码" : "Client Secret"}
              <Input
                type="password"
                autoComplete="new-password"
                value={draft.secret}
                disabled={!canEdit}
                required={!currentProvider?.configured}
                placeholder={currentProvider?.configured ? "留空以保留现有密钥" : "输入密钥"}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, secret: event.target.value }))
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={!canEdit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              启用并在登录页展示
            </label>
            {message ? (
              <p className="text-sm text-(--ds-success)" role="status">
                {message}
              </p>
            ) : null}
            {save.error || disable.error || test.error ? (
              <p className="text-sm text-destructive" role="alert">
                操作失败，请检查配置与当前密码后重试。
              </p>
            ) : null}
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={save.isPending || !draft.id}>
                  保存配置
                </Button>
                {draft.existing ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!draft.enabled}
                    onClick={() => setAction("disable")}
                  >
                    停用
                  </Button>
                ) : null}
                {draft.existing ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!currentProvider?.configured || test.isPending}
                    onClick={() => setAction("test")}
                  >
                    测试连接
                  </Button>
                ) : null}
              </div>
            ) : null}
          </form>
          {draft.kind !== "ldap" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              测试连接会打开提供者授权页；成功后返回此处，不创建用户账号。
            </p>
          ) : null}
        </section>
      </div>
      <ReauthenticationDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title="确认认证配置操作"
        description="输入当前 OpenRUM 密码。验证有效期为五分钟。"
        confirmVariant="default"
        onConfirmed={async () => {
          if (action === "save") await save.mutateAsync();
          if (action === "disable") await disable.mutateAsync();
          if (action === "test") await test.mutateAsync();
          setAction(null);
        }}
      />
    </AdminPageLayout>
  );
}

function OAuthFields({
  draft,
  setDraft,
  disabled,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  disabled: boolean;
}) {
  const update = (key: keyof ProviderSettings, value: string) =>
    setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  return (
    <>
      <label className="grid gap-2 text-sm font-medium">
        Client ID
        <Input
          value={draft.settings.clientId ?? ""}
          disabled={disabled}
          required
          onChange={(event) => update("clientId", event.target.value)}
        />
      </label>
      {draft.kind === "oidc" ? (
        <label className="grid gap-2 text-sm font-medium">
          Issuer URL
          <Input
            type="url"
            value={draft.settings.issuerUrl ?? ""}
            disabled={disabled}
            required
            placeholder="https://sso.example.com"
            onChange={(event) => update("issuerUrl", event.target.value)}
          />
        </label>
      ) : null}
      <p className="text-xs text-muted-foreground">
        回调地址：{window.location.origin}/api/v1/auth/providers/{draft.id || "提供者ID"}/callback
      </p>
    </>
  );
}

function LDAPFields({
  draft,
  setDraft,
  disabled,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  disabled: boolean;
}) {
  const update = (key: keyof ProviderSettings, value: string) =>
    setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const fields: Array<[keyof ProviderSettings, string, string]> = [
    ["ldapUrl", "LDAP URL", "ldaps://ldap.example.com:636"],
    ["baseDn", "Base DN", "dc=example,dc=com"],
    ["bindDn", "搜索账号 DN", "cn=reader,dc=example,dc=com"],
    ["userFilter", "用户搜索过滤器", "(uid={username})"],
    ["idAttribute", "稳定 ID 属性", "entryUUID 或 objectGUID"],
    ["emailAttribute", "邮箱属性", "mail"],
    ["nameAttribute", "显示名称属性", "displayName"],
  ];
  return (
    <>
      {fields.map(([key, label, placeholder]) => (
        <label key={key} className="grid gap-2 text-sm font-medium">
          {label}
          <Input
            value={draft.settings[key] ?? ""}
            disabled={disabled}
            required={key !== "nameAttribute"}
            placeholder={placeholder}
            onChange={(event) => update(key, event.target.value)}
          />
        </label>
      ))}
      <label className="grid gap-2 text-sm font-medium">
        自定义 CA 证书（PEM，可选）
        <textarea
          className="min-h-24 rounded-md border border-input bg-background p-3 font-mono text-xs"
          value={draft.settings.caCertificate ?? ""}
          disabled={disabled}
          onChange={(event) => update("caCertificate", event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        ldap:// 会先升级到 StartTLS；不会在明文连接上验证密码。
      </p>
    </>
  );
}
