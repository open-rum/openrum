import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createOnboardingKey, listProjectKeys, rotateProjectKey } from "@/lib/api/client";
import type { Project } from "@/lib/api/projects";
import { InstallSnippet } from "./InstallSnippet";

export function SdkSetupCard({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const canManageKey = project.role === "owner" || project.role === "admin";
  const keysQuery = useQuery({
    queryKey: ["project-keys", project.id],
    queryFn: ({ signal }) => listProjectKeys(project.id, signal),
    enabled: canManageKey,
  });
  const activeKeys = keysQuery.data?.keys.filter((key) => !key.revokedAt) ?? [];
  const defaultKey = activeKeys.find((key) => key.isDefault);
  const dsn = defaultKey?.dsn ?? null;
  const hasLegacyKey = Boolean(defaultKey && !defaultKey.dsn);
  const keyMutation = useMutation({
    mutationFn: () =>
      defaultKey && !defaultKey.dsn
        ? rotateProjectKey(project.id, defaultKey.id)
        : createOnboardingKey(project.id),
    onSuccess: () => {
      void keysQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["connection-status", project.id] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>安装与配置</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!dsn ? (
          <div className="flex flex-col gap-3">
            {keysQuery.isLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                正在加载 SDK 配置…
              </p>
            ) : keysQuery.error ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-destructive" role="alert">
                  {keysQuery.error.message}
                </p>
                <Button type="button" variant="outline" onClick={() => void keysQuery.refetch()}>
                  重试
                </Button>
              </div>
            ) : canManageKey ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {hasLegacyKey
                    ? "升级默认 DSN 后可生成完整的 SDK 配置。"
                    : "生成默认 DSN 后可获取完整的 SDK 配置。"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => keyMutation.mutate()}
                  disabled={keyMutation.isPending}
                >
                  <KeyRoundIcon data-icon="inline-start" />
                  {keyMutation.isPending
                    ? "正在创建…"
                    : hasLegacyKey
                      ? "升级默认 DSN"
                      : "生成默认 DSN"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                请联系 Owner 或 Admin 获取默认 DSN，并填入下方 SDK 配置。
              </p>
            )}
            {keyMutation.error ? (
              <p className="text-sm text-destructive" role="alert">
                {keyMutation.error.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <InstallSnippet
          dsn={dsn}
          environment={project.environment}
          platform={project.sdkPlatform}
        />
      </CardContent>
    </Card>
  );
}
