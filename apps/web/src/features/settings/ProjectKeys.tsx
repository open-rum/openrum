import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowClockwise, Check, Copy, Key, Plus, Trash, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { apiFetch, csrfHeaders } from "@/lib/auth/session";

type ProjectKey = {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  writeKey?: string;
};

type KeyList = { keys: ProjectKey[] };

type ProjectKeysProps = {
  projectId: string;
};

export function ProjectKeysRoute() {
  const { projectId } = useParams({ from: "/protected/projects/$projectId/settings/keys" });
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
  const [revealed, setRevealed] = useState<ProjectKey | null>(null);
  const [copied, setCopied] = useState(false);
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
    onSuccess: (key) => {
      setName("");
      setCopied(false);
      setRevealed(key);
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
    onSuccess: (key) => {
      setCopied(false);
      setRevealed(key);
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

  async function copyRevealedKey() {
    if (!revealed?.writeKey) return;
    await navigator.clipboard.writeText(revealed.writeKey);
    setCopied(true);
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-8" aria-labelledby="project-keys-title">
      <header className="flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            id="project-keys-title"
            className="text-2xl font-semibold tracking-tight text-foreground"
          >
            项目 Write Keys
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            浏览器 SDK 使用 Write Key 向该项目上报事件。Key 仅具备写入权限，不可读取监控数据。
          </p>
        </div>
      </header>

      {revealed?.writeKey ? (
        <div className="mt-6 border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <Warning className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">请立即复制并安全保存</h2>
              <p className="mt-1 text-sm leading-6 opacity-80">
                这是完整 Key 唯一一次显示。关闭提示后，OpenRUM 无法再次恢复它。
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <code className="min-w-0 flex-1 overflow-x-auto border border-amber-300 bg-white px-3 py-2.5 font-mono text-sm whitespace-nowrap text-slate-950 dark:border-amber-800 dark:bg-black/30 dark:text-white">
                  {revealed.writeKey}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => void copyRevealedKey()}
                >
                  {copied ? <Check weight="bold" /> : <Copy />}
                  {copied ? "已复制" : "复制 Key"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10"
                  onClick={() => setRevealed(null)}
                >
                  我已保存
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <form
        className="mt-6 flex flex-col gap-3 border border-border bg-card p-5 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) createKey.mutate(trimmed);
        }}
      >
        <label className="min-w-0 flex-1 text-sm font-medium text-foreground">
          Key 名称
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
          创建 Write Key
        </Button>
      </form>

      {mutationError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {mutationError.message}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto border border-border bg-card">
        <table className="w-full min-w-3xl border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-3">名称</th>
              <th className="px-4 py-3">前缀</th>
              <th className="px-4 py-3">最近使用</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keysQuery.isLoading ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                  正在加载 Write Keys…
                </td>
              </tr>
            ) : keysQuery.isError ? (
              <tr>
                <td className="px-4 py-8 text-center text-destructive" colSpan={5}>
                  {keysQuery.error.message}
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>
                  <Key className="mx-auto mb-2 size-6" aria-hidden="true" />
                  暂无 Write Key，请先创建一个。
                </td>
              </tr>
            ) : (
              keys.map((key) => {
                const revoked = Boolean(key.revokedAt);
                return (
                  <tr key={key.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {key.prefix}••••••••
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {key.lastUsedAt ? formatDate(key.lastUsedAt) : "尚未使用"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          revoked
                            ? "text-muted-foreground"
                            : "text-emerald-700 dark:text-emerald-400"
                        }
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
                              window.confirm("吊销后使用该 Key 的 SDK 将无法继续上报。确认吊销？")
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
    </section>
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
