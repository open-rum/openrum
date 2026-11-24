import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { SendIcon, TriangleAlertIcon as AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { getConnectionStatus, sendTestEvent } from "@/lib/api/client";
import { getProject, listOrganizations } from "@/lib/api/projects";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import { ProjectCreatePage } from "@/features/projects/ProjectCreatePage";
import { uploadTokensPath } from "@/features/releases/releaseLinks";
import { ConnectionHealth } from "./ConnectionHealth";
import { SdkSetupCard } from "./SdkSetupCard";

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
  const statusQuery = useQuery({
    queryKey: ["connection-status", project.id],
    queryFn: ({ signal }) => getConnectionStatus(project.id, signal),
    refetchInterval: (query) => {
      const current = query.state.data;
      if (current?.lastEventQueryableAt) return 30_000;
      if (current?.lastEventReceivedAt) return 5_000;
      if (current?.lastSdkSeenAt) return 3_000;
      return Math.min(10_000, 2_000 * 2 ** Math.min(query.state.fetchFailureCount, 2));
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
  const canSendTest = project.role !== "viewer";

  return (
    <ConsolePage width="narrow">
      <ConsolePageHeader
        title={queryableAt ? "接入状态" : "连接第一个真实页面"}
        titleId="onboarding-title"
        description="配置 SDK，并查看最近的数据接收状态。"
      />

      {status ? <ConnectionHealth status={status} /> : null}
      {statusQuery.error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>无法读取连接状态</AlertTitle>
          <AlertDescription>
            {statusQuery.error.message} 请确认 API 与 Redis 正常后重试。
          </AlertDescription>
        </Alert>
      ) : null}

      <SdkSetupCard project={project} />

      <Card>
        <CardHeader>
          <CardTitle>Source Map</CardTitle>
          <CardDescription>
            上传令牌、构建插件和已上传的版本都在 Source Map
            页管理，用来把压缩后的错误堆栈还原到源码。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href={uploadTokensPath(project.id)}>管理 Source Map 与上传令牌</a>
          </Button>
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
                进入仪表盘
              </Link>
            </Button>
          ) : (
            <Button disabled>进入仪表盘</Button>
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
      <Skeleton className="h-96" aria-label="正在加载 SDK 配置" />
    </ConsolePage>
  );
}
