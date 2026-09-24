import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  KeyRoundIcon,
  CheckIcon,
  CopyIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon as AlertTriangleIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import {
  createOnboardingKey,
  getConnectionStatus,
  listProjectKeys,
  rotateProjectKey,
  sendTestEvent,
} from "@/lib/api/client";
import { getProject, listOrganizations } from "@/lib/api/projects";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import { ProjectCreatePage } from "@/features/projects/ProjectCreatePage";
import { getProjectPlatform } from "@/features/projects/projectPlatforms";
import { ConnectionStatus } from "./ConnectionStatus";
import { rejectGuidance } from "./guidance";
import { InstallSnippet } from "./InstallSnippet";

export function OnboardingPage() {
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const project = useQuery({
    queryKey: ["project", routeProjectId],
    queryFn: ({ signal }) => getProject(routeProjectId!, signal),
    enabled: Boolean(routeProjectId),
  });

  if (organizations.isLoading || project.isLoading) return <OnboardingLoading />;
  if (!organizations.data?.organizations.length || !routeProjectId) return <ProjectCreatePage />;
  if (!project.data) return <ProjectCreatePage />;
  return <ProjectOnboarding project={project.data} />;
}

function ProjectOnboarding({
  project,
}: {
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
}) {
  const [copied, setCopied] = useState(false);
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
  const statusQuery = useQuery({
    queryKey: ["connection-status", project.id],
    queryFn: ({ signal }) => getConnectionStatus(project.id, signal),
    refetchInterval: (query) => {
      const current = query.state.data;
      if (current?.lastEventQueryableAt) return false;
      if (current?.lastEventReceivedAt) return 5_000;
      if (current?.lastSdkSeenAt) return 3_000;
      return Math.min(10_000, 2_000 * 2 ** Math.min(query.state.fetchFailureCount, 2));
    },
  });
  const keyMutation = useMutation({
    mutationFn: () =>
      defaultKey && !defaultKey.dsn
        ? rotateProjectKey(project.id, defaultKey.id)
        : createOnboardingKey(project.id),
    onSuccess: () => {
      setCopied(false);
      void keysQuery.refetch();
      void statusQuery.refetch();
    },
  });
  const testMutation = useMutation({
    mutationFn: () => sendTestEvent(project.id),
    onSuccess: () => void statusQuery.refetch(),
  });
  const status = statusQuery.data;
  const queryableAt = status?.lastEventQueryableAt;
  useEffect(() => {
    if (queryableAt) recordProductEvent("first_event_queryable", project.id);
  }, [project.id, queryableAt]);
  const guidance = status?.lastRejectReason ? rejectGuidance[status.lastRejectReason] : undefined;
  const canSendTest = project.role !== "viewer";

  return (
    <ConsolePage width="narrow">
      <ConsolePageHeader
        title="连接第一个真实页面"
        titleId="onboarding-title"
        description="依次确认凭证、SDK、事件接收和 ClickHouse 可查询状态。通常 60 秒内完成。"
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新状态
          </Button>
        }
      />

      {guidance ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{guidance.title}</AlertTitle>
          <AlertDescription>{guidance.action}</AlertDescription>
        </Alert>
      ) : null}
      {statusQuery.error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>无法读取连接状态</AlertTitle>
          <AlertDescription>
            {statusQuery.error.message} 请确认 API 与 Redis 正常后重试。
          </AlertDescription>
        </Alert>
      ) : null}

      <ConnectionStatus
        status={status}
        loading={statusQuery.isLoading}
        hasInstallDSN={Boolean(dsn || status?.keyConfigured)}
      />

      <Card>
        <CardHeader>
          <CardTitle>客户端 DSN</CardTitle>
          <CardDescription>一个字符串包含上报地址和只写凭证，不提供数据读取权限。</CardDescription>
          <CardAction>
            <KeyRoundIcon aria-hidden="true" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <code className="overflow-x-auto rounded-lg bg-muted p-3 text-sm">
            {dsn ??
              (hasLegacyKey
                ? "旧版 DSN 无法从哈希恢复 · 创建新 DSN 后可持续查看"
                : status?.keyConfigured
                  ? "已有旧版写入键 · 创建新 DSN 后可持续查看"
                  : "尚未配置 DSN")}
          </code>
          {dsn ? (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(dsn);
                  setCopied(true);
                }}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? "已复制" : "复制 DSN"}
              </Button>
            </div>
          ) : null}
          {canManageKey && !dsn ? (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => keyMutation.mutate()}
                disabled={keyMutation.isPending || keysQuery.isLoading}
              >
                <KeyRoundIcon data-icon="inline-start" />
                {keyMutation.isPending
                  ? "正在创建…"
                  : hasLegacyKey
                    ? "升级默认 DSN"
                    : "生成默认 DSN"}
              </Button>
            </div>
          ) : !canManageKey && !dsn ? (
            <p className="text-sm text-muted-foreground">请联系 Owner 或 Admin 获取默认 DSN。</p>
          ) : null}
          {keyMutation.error ? (
            <p className="text-sm text-destructive" role="alert">
              {keyMutation.error.message}
            </p>
          ) : null}
          {keysQuery.error ? (
            <p className="text-sm text-destructive" role="alert">
              {keysQuery.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SDK 配置</CardTitle>
          <CardDescription>
            根据项目的 {getProjectPlatform(project.sdkPlatform).label} 平台，把 Browser SDK
            放在正确的客户端入口。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InstallSnippet
            dsn={dsn}
            environment={project.environment}
            platform={project.sdkPlatform}
          />
        </CardContent>
      </Card>

      <Separator />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-medium">验证数据链路</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            真实页面尚未发布时，可发送 synthetic Page View 验证 Kafka 与 Consumer；它不会计入生产
            KPI。
          </p>
        </div>
        <div className="flex gap-2">
          {canSendTest ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              <SendIcon data-icon="inline-start" />
              {testMutation.isPending ? "发送中…" : "发送测试事件"}
            </Button>
          ) : null}
          {status?.lastEventQueryableAt ? (
            <Button asChild>
              <Link to="/projects/$projectId/overview" params={{ projectId: project.id }}>
                进入数据大盘
              </Link>
            </Button>
          ) : (
            <Button disabled>进入数据大盘</Button>
          )}
        </div>
      </div>
      {testMutation.error ? (
        <p className="text-sm text-destructive" role="alert">
          {testMutation.error.message}
        </p>
      ) : null}
    </ConsolePage>
  );
}

function OnboardingLoading() {
  return (
    <ConsolePage width="narrow">
      <Skeleton className="h-24" />
      <ConnectionStatus loading hasInstallDSN={false} />
    </ConsolePage>
  );
}
