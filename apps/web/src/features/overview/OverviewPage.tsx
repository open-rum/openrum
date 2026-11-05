import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ConsolePage } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
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
      <div className="card card-border min-h-80 bg-base-100">
        <div className="card-body items-center justify-center text-center">
          <h2 className="card-title">先创建一个监控项目</h2>
          <p className="text-base-content/70">创建项目后，接入向导会带你完成 Browser SDK 验证。</p>
          <div className="card-actions mt-2">
            <Link className="btn btn-primary" to="/onboarding">
              创建项目
            </Link>
          </div>
        </div>
      </div>
    </ConsolePage>
  );
}

function OverviewShellSkeleton() {
  return (
    <ConsolePage width="fluid" aria-label="正在加载仪表盘">
      <div className="skeleton h-24" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton h-40" />
        ))}
      </div>
      <div className="skeleton h-80" />
    </ConsolePage>
  );
}
