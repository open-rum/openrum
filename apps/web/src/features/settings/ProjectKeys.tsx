import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowClockwise, Check, Copy, Key, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { apiFetch, csrfHeaders } from "@/lib/auth/session";
import { SettingsShell } from "./SettingsShell";

type ProjectKey = {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  dsn?: string;
  isDefault: boolean;
};

type KeyList = { keys: ProjectKey[] };

type ProjectKeysProps = {
  projectId: string;
};

export function ProjectKeysRoute() {
  const { projectId } = useParams({ from: "/protected/settings/project/$projectId/keys" });
  return <ProjectKeys projectId={projectId} />;
}

function mutationHeaders() {
  return {
    "Content-Type": "application/json",
    ...csrfHeaders(),
  };
}

export function ProjectKeys({ projectId }: ProjectKeysProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const queryKey = useMemo(() => ["project-keys", projectId] as const, [projectId]);
  const endpoint = `/api/v1/projects/${encodeURIComponent(projectId)}/keys`;

  const keysQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<KeyList>(endpoint, {}, { redirectOnUnauthorized: true }),
    enabled: projectId.length > 0,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const createKey = useMutation({
    mutationFn: (keyName: string) =>
      apiFetch<ProjectKey>(
        endpoint,
        {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({ name: keyName }),
        },
        { redirectOnUnauthorized: true },
      ),
    onSuccess: () => {
      setName("");
      setCopiedKeyId(null);
      void refresh();
    },
  });
  const rotateKey = useMutation({
    mutationFn: (keyId: string) =>
      apiFetch<ProjectKey>(
        `${endpoint}/${encodeURIComponent(keyId)}/rotate`,
        {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({}),
        },
        { redirectOnUnauthorized: true },
      ),
    onSuccess: () => {
      setCopiedKeyId(null);
      void refresh();
    },
  });
  const revokeKey = useMutation({
    mutationFn: (keyId: string) =>
      apiFetch<void>(
        `${endpoint}/${encodeURIComponent(keyId)}`,
        {
          method: "DELETE",
          headers: mutationHeaders(),
        },
        { redirectOnUnauthorized: true },
      ),
    onSuccess: () => void refresh(),
  });

  const mutationError = createKey.error ?? rotateKey.error ?? revokeKey.error;
  const busy = createKey.isPending || rotateKey.isPending || revokeKey.isPending;
  const keys = keysQuery.data?.keys ?? [];
  const defaultKey = keys.find((key) => key.isDefault && !key.revokedAt);
  const advancedKeys = keys.filter((key) => !key.isDefault);

  async function copyKey(key: ProjectKey) {
    if (!key.dsn) return;
    await navigator.clipboard.writeText(key.dsn);
    setCopiedKeyId(key.id);
  }

  return (
    <SettingsShell
      titleId="project-keys-title"
      title="客户端 DSN"
      description="每个项目自动拥有一个默认 DSN，浏览器 SDK 正常接入只需要复制这一项。"
    >
      <div className="flex flex-col gap-6">
        <section className="border border-border bg-card p-6" aria-labelledby="default-dsn-title">
          <div className="flex flex-col gap-5">
            <div>
              <div className="flex items-center gap-2">
                <Key className="size-5 text-primary" weight="fill" aria-hidden="true" />
                <h2 id="default-dsn-title" className="text-base font-semibold text-foreground">
                  默认 DSN
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                项目创建时自动生成；它只能写入遥测数据，不能读取项目内容。
              </p>
            </div>

            {keysQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">正在加载默认 DSN…</p>
            ) : keysQuery.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {keysQuery.error.message}
              </p>
            ) : defaultKey ? (
              <>
                {defaultKey.dsn ? (
                  <code className="overflow-x-auto border border-border bg-muted/50 px-4 py-3 font-mono text-sm whitespace-nowrap text-foreground">
                    {defaultKey.dsn}
                  </code>
                ) : (
                  <p className="border border-(--ds-warning)/30 bg-(--ds-warning-soft) px-4 py-3 text-sm text-(--ds-warning)">
                    这是升级前创建的旧键，轮换一次后即可在这里持续查看完整 DSN。
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!defaultKey.dsn}
                    onClick={() => void copyKey(defaultKey)}
                  >
                    {copiedKeyId === defaultKey.id ? <Check weight="bold" /> : <Copy />}
                    {copiedKeyId === defaultKey.id ? "已复制" : "复制默认 DSN"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("轮换后旧 DSN 会立即失效。确认继续？"))
                        rotateKey.mutate(defaultKey.id);
                    }}
                  >
                    <ArrowClockwise />
                    轮换
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button type="button" disabled={busy} onClick={() => createKey.mutate("Default")}>
                  <Plus weight="bold" />
                  生成默认 DSN
                </Button>
              </div>
            )}
          </div>
        </section>

        {mutationError ? (
          <p className="text-sm text-destructive" role="alert">
            {mutationError.message}
          </p>
        ) : null}

        <details className="group border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
            高级 DSN 管理
            <span className="text-xs font-normal text-muted-foreground">
              {advancedKeys.filter((key) => !key.revokedAt).length} 个额外 DSN
            </span>
          </summary>

          <div className="border-t border-border p-5">
            <p className="mb-5 text-sm text-muted-foreground">
              仅在需要隔离多个客户端或独立轮换策略时创建额外 DSN。
            </p>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = name.trim();
                if (trimmed) createKey.mutate(trimmed);
              }}
            >
              <label className="min-w-0 flex-1 text-sm font-medium text-foreground">
                额外 DSN 名称
                <input
                  className="mt-2 h-10 w-full border border-input bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                  value={name}
                  maxLength={120}
                  placeholder="例如：商城 H5 · Production"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <Button type="submit" className="h-10 px-4" disabled={!name.trim() || busy}>
                <Plus weight="bold" />
                创建额外 DSN
              </Button>
            </form>
          </div>

          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full min-w-3xl border-collapse text-left text-sm">
              <thead className="bg-muted/60 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">客户端 DSN</th>
                  <th className="px-4 py-3">最近使用</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keysQuery.isLoading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                      正在加载客户端 DSN…
                    </td>
                  </tr>
                ) : keysQuery.isError ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-destructive" colSpan={5}>
                      {keysQuery.error.message}
                    </td>
                  </tr>
                ) : advancedKeys.length === 0 ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>
                      <Key className="mx-auto mb-2 size-6" aria-hidden="true" />
                      暂无额外 DSN。
                    </td>
                  </tr>
                ) : (
                  advancedKeys.map((key) => {
                    const revoked = Boolean(key.revokedAt);
                    return (
                      <tr key={key.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">{key.name}</td>
                        <td className="max-w-lg px-4 py-3">
                          {key.dsn ? (
                            <code className="block overflow-x-auto font-mono text-xs whitespace-nowrap text-muted-foreground">
                              {key.dsn}
                            </code>
                          ) : (
                            <span className="text-xs text-(--ds-warning)">
                              旧版密钥无法恢复，轮换后即可持续查看
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {key.lastUsedAt ? formatDate(key.lastUsedAt) : "尚未使用"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={revoked ? "text-muted-foreground" : "text-(--ds-success)"}
                          >
                            {revoked ? "已吊销" : "有效"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!key.dsn}
                              onClick={() => void copyKey(key)}
                            >
                              {copiedKeyId === key.id ? <Check weight="bold" /> : <Copy />}
                              {copiedKeyId === key.id ? "已复制" : "复制"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={revoked || busy}
                              onClick={() => {
                                if (window.confirm("轮换后旧 Key 会立即失效。确认继续？"))
                                  rotateKey.mutate(key.id);
                              }}
                            >
                              <ArrowClockwise />
                              轮换
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={revoked || busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "吊销后使用该 Key 的 SDK 将无法继续上报。确认吊销？",
                                  )
                                ) {
                                  revokeKey.mutate(key.id);
                                }
                              }}
                            >
                              <Trash />
                              吊销
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </SettingsShell>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
