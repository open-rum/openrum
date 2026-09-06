import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  KeyRoundIcon,
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
import { createOnboardingKey, getConnectionStatus, sendTestEvent } from "@/lib/api/client";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import { ProjectCreatePage } from "@/features/projects/ProjectCreatePage";
import { ConnectionStatus } from "./ConnectionStatus";
import { rejectGuidance } from "./guidance";
import { InstallSnippet } from "./InstallSnippet";

export function OnboardingPage() {
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project = useMemo(
    () =>
      projects.data?.projects.find((item) => item.id === routeProjectId) ??
      projects.data?.projects[0],
    [projects.data, routeProjectId],
  );

  if (organizations.isLoading || projects.isLoading) return <OnboardingLoading />;
  if (!organization || !project) return <ProjectCreatePage />;
  return <ProjectOnboarding project={project} />;
}

function ProjectOnboarding({
  project,
}: {
  project: NonNullable<Awaited<ReturnType<typeof listProjects>>["projects"][number]>;
}) {
  const storageKey = `openrum:write-key:${project.id}`;
  const [writeKey, setWriteKey] = useState<string | null>(() => sessionStorage.getItem(storageKey));
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
    mutationFn: () => createOnboardingKey(project.id),
    onSuccess: (key) => {
      if (!key.writeKey) return;
      sessionStorage.setItem(storageKey, key.writeKey);
      setWriteKey(key.writeKey);
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
  const canManageKey = project.role === "owner" || project.role === "admin";
  const canSendTest = project.role !== "viewer";

  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8"
      aria-labelledby="onboarding-title"
    >
      <header className="flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">项目 / {project.name} / 接入向导</p>
          <h1 id="onboarding-title" className="mt-2 text-2xl font-semibold tracking-tight">
            连接第一个真实页面
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            依次确认凭证、SDK、事件接收和 ClickHouse 可查询状态。通常 60 秒内完成。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void statusQuery.refetch()}
          disabled={statusQuery.isFetching}
        >
          <RefreshCwIcon data-icon="inline-start" />
          刷新状态
        </Button>
      </header>

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
        hasInstallKey={Boolean(writeKey || status?.keyConfigured)}
      />

      <Card>
        <CardHeader>
          <CardTitle>浏览器 Write Key</CardTitle>
          <CardDescription>Key 仅允许写入事件，完整值不会再次从服务端读取。</CardDescription>
          <CardAction>
            <KeyRoundIcon aria-hidden="true" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <code className="overflow-x-auto rounded-lg bg-muted p-3 text-sm">
            {writeKey ??
              (status?.keyConfigured ? "已有可用 Key · 完整值已隐藏" : "尚未配置 Write Key")}
          </code>
          {canManageKey ? (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => keyMutation.mutate()}
                disabled={keyMutation.isPending}
              >
                <KeyRoundIcon data-icon="inline-start" />
                {keyMutation.isPending
                  ? "正在创建…"
                  : status?.keyConfigured
                    ? "创建新的接入 Key"
                    : "创建接入 Key"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              请联系 Owner 或 Admin 创建并安全传递 Write Key。
            </p>
          )}
          {keyMutation.error ? (
            <p className="text-sm text-destructive" role="alert">
              {keyMutation.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SDK 配置</CardTitle>
          <CardDescription>
            安装 <code>@openrum/browser-sdk</code>，把初始化代码放在应用入口。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InstallSnippet writeKey={writeKey} environment={project.environment} />
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
    </section>
  );
}

function OnboardingLoading() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <Skeleton className="h-24" />
      <ConnectionStatus loading hasInstallKey={false} />
    </section>
  );
}
