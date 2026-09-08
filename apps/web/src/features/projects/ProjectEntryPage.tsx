import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AsyncError } from "@/components/ui/AsyncState";
import { Skeleton } from "@/components/ui/skeleton";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { rememberProject, selectProject } from "@/lib/projects/currentProject";

export function ProjectEntryPage() {
  const navigate = useNavigate();
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project = organization
    ? selectProject(projects.data?.projects ?? [], organization.id)
    : undefined;
  useEffect(() => {
    if (organizations.error || projects.error) return;
    if (organizations.isLoading || projects.isLoading) return;
    if (!organization || !project) {
      void navigate({ to: "/projects/new", replace: true });
      return;
    }
    rememberProject(project);
    void navigate({
      to: "/projects/$projectId/overview",
      params: { projectId: project.id },
      replace: true,
    });
  }, [
    navigate,
    organization,
    organizations.error,
    organizations.isLoading,
    project,
    projects.error,
    projects.isLoading,
  ]);

  if (organizations.error || projects.error) {
    return (
      <section className="mx-auto w-full max-w-6xl px-6 py-8">
        <AsyncError
          error={organizations.error ?? projects.error}
          title="无法确定默认项目"
          remediation="请检查 API 服务后重试；最近使用的项目记录不会被清除。"
          onRetry={() => {
            void organizations.refetch();
            void projects.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8">
      <Skeleton className="h-20" />
      <Skeleton className="h-64" />
    </section>
  );
}
