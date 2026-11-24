import { lazy, Suspense, type ReactNode } from "react";
import { ProjectConnectionIllustration } from "@/components/illustrations/ProjectConnectionIllustration";
import { useQuery } from "@tanstack/react-query";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConnectionStatus } from "@/lib/api/client";
import { getProject } from "@/lib/api/projects";
import { getProjectPlatform } from "@/features/projects/projectPlatforms";
import { SdkSetupCard } from "./SdkSetupCard";

const DevDataNotice = import.meta.env.DEV
  ? lazy(() => import("@/features/devdata/DevDataNotice"))
  : null;

export default function ProjectSdkGate({
  projectId,
  connection,
  children,
}: {
  projectId: string;
  connection: { data?: ConnectionStatus; isPending: boolean; isError: boolean };
  children: ReactNode;
}) {
  const needsSetup = !connection.isError && connection.data?.sdkConnected === false;
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
    enabled: needsSetup,
  });

  // A failed or older status API cannot establish that a project has never connected.
  if (!connection.isPending && !needsSetup) return children;
  if (project.error && needsSetup) {
    return (
      <ConsolePage width="narrow">
        <AsyncError
          error={project.error}
          title="无法加载 SDK 接入指引"
          remediation="请重试以获取当前项目的开发平台和配置。"
          onRetry={() => void project.refetch()}
        />
      </ConsolePage>
    );
  }
  if (connection.isPending || !project.data) {
    return (
      <ConsolePage width="narrow" aria-label="正在检查 SDK 接入状态">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </ConsolePage>
    );
  }
  return (
    <ConsolePage width="narrow">
      <div className="flex flex-col items-center gap-5 py-2 sm:py-4">
        <ProjectConnectionIllustration className="w-48" />
        <ConsolePageHeader
          className="items-center text-center [&_h1]:mx-auto"
          title="您还没有接入 SDK"
          description={`为您的 ${getProjectPlatform(project.data.sdkPlatform).label} 应用完成以下配置，收到上报后，就能在这里查看数据了。`}
        />
      </div>
      {DevDataNotice ? (
        <Suspense fallback={null}>
          <DevDataNotice project={project.data} />
        </Suspense>
      ) : null}
      <SdkSetupCard project={project.data} />
    </ConsolePage>
  );
}
