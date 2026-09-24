import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, WebhookIcon } from "lucide-react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { Button } from "@/components/ui/button";
import { createWebhookChannel, getChannels } from "@/lib/api/alerts";
import { listOrganizations } from "@/lib/api/projects";

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const channels = useQuery({
    queryKey: ["channels", organization?.id],
    queryFn: ({ signal }) => getChannels(organization!.id, signal),
    enabled: Boolean(organization),
  });
  const [saved, setSaved] = useState(false);
  const create = useMutation({
    mutationFn: (input: { name: string; url: string; secret: string }) =>
      createWebhookChannel(organization!.id, input),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["channels", organization?.id] });
    },
  });
  return (
    <ConsolePage width="narrow">
      <ConsolePageHeader
        title="通知渠道"
        description="Webhook 密钥加密保存，发送时签名；目标地址会执行 SSRF 防护。"
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="rounded-lg border border-border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            create.mutate({
              name: String(form.get("name")),
              url: String(form.get("url")),
              secret: String(form.get("secret")),
            });
          }}
        >
          <div className="flex items-center gap-2">
            <WebhookIcon className="size-5" />
            <h2 className="font-semibold">添加 Webhook</h2>
          </div>
          {[
            ["name", "名称", "研发值班"],
            ["url", "HTTPS URL", "https://hooks.example.com/openrum"],
            ["secret", "签名密钥", "至少 16 个字符"],
          ].map(([name, label, placeholder]) => (
            <label key={name} className="mt-5 block text-sm font-medium">
              {label}
              <input
                name={name}
                type={name === "secret" ? "password" : name === "url" ? "url" : "text"}
                minLength={name === "secret" ? 16 : undefined}
                required
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3"
                placeholder={placeholder}
              />
            </label>
          ))}
          <Button className="mt-5" type="submit" disabled={create.isPending}>
            保存渠道
          </Button>
          {saved ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-(--ds-success)" role="status">
              <CheckCircle2Icon className="size-4" />
              渠道已加密保存
            </p>
          ) : null}
          {create.error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              保存失败，请检查 HTTPS 地址与权限。
            </p>
          ) : null}
        </form>
        <aside className="rounded-lg border border-border bg-muted/30 p-5">
          <h2 className="font-semibold">已配置</h2>
          <div className="mt-4 space-y-3">
            {channels.data?.channels.map((channel) => (
              <div key={channel.id} className="rounded-md border border-border bg-card p-3">
                <strong className="text-sm">{channel.name}</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {channel.kind.toUpperCase()} · {channel.enabled ? "已启用" : "已停用"}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </ConsolePage>
  );
}
