import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ConsolePage } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getProject, listOrganizations, listProjects } from "@/lib/api/projects";

const ProjectDashboard = lazy(() => import("@/features/dashboard/ProjectDashboard"));

export function OverviewPage() {
  const { projectId: routeProjectId, dashboardId } = useParams({ strict: false }) as {
    projectId?: string;
    dashboardId?: string;
  };
  const directProject = useQuery({
    queryKey: ["project", routeProjectId],
    queryFn: ({ signal }) => getProject(routeProjectId!, signal),
    enabled: Boolean(routeProjectId),
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    enabled: !routeProjectId,
  });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: !routeProjectId && Boolean(organization),
  });
  const project = routeProjectId ? directProject.data : projects.data?.projects[0];

  if (routeProjectId ? directProject.isLoading : organizations.isLoading || projects.isLoading)
    return <OverviewShellSkeleton />;
  const error = routeProjectId ? directProject.error : (organizations.error ?? projects.error);
  if (error)
    return (
      <ConsolePage width="fluid">
        <AsyncError
          error={error}
          title="无法加载项目"
          remediation="项目可能已被移除，或你已失去访问权限。"
          onRetry={() => {
            if (routeProjectId) void directProject.refetch();
            else if (organizations.error) void organizations.refetch();
            else void projects.refetch();
          }}
        />
      </ConsolePage>
    );
  if (!project) return <NoProject />;
  return (
    <Suspense fallback={<OverviewShellSkeleton />}>
      <ProjectDashboard project={project} dashboardId={dashboardId} />
    </Suspense>
  );
}

function NoProject() {
  return (
    <ConsolePage width="narrow">
      <Empty className="min-h-80 border border-border">
        <EmptyHeader>
          <EmptyTitle>先创建一个监控项目</EmptyTitle>
          <EmptyDescription>创建项目后，接入向导会带你完成 Browser SDK 验证。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to="/onboarding">创建项目</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </ConsolePage>
  );
}

function OverviewShellSkeleton() {
  return (
    <ConsolePage width="fluid" aria-label="正在加载仪表盘">
      <Skeleton className="h-24" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </ConsolePage>
  );
}
