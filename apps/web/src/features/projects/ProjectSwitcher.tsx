import type { ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, FolderKanbanIcon, PlusIcon, Rows3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import type { Organization, Project } from "@/lib/api/projects";
import { rememberProject } from "@/lib/projects/currentProject";

export function ProjectSwitcher({
  organization,
  projects,
  project,
  loading,
  children,
}: {
  organization?: Organization;
  projects: Project[];
  project?: Project;
  loading: boolean;
  children: ReactElement;
}) {
  const navigate = useNavigate();

  return (
    <HoverCard openDelay={120} closeDelay={240}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="project-hover-card" side="right" align="start" sideOffset={8}>
        <div className="project-hover-card__heading">
          <span>{organization?.name ?? "工作区"}</span>
          <small>{loading ? "加载项目…" : `${projects.length} 个项目`}</small>
        </div>
        <nav className="project-hover-card__list" aria-label="切换项目">
          {projects.map((item) => (
            <Button
              key={item.id}
              className="project-hover-card__item"
              type="button"
              variant="ghost"
              aria-current={item.id === project?.id ? "page" : undefined}
              onClick={() => {
                rememberProject(item);
                void navigate({
                  to: "/projects/$projectId/overview",
                  params: { projectId: item.id },
                });
              }}
            >
              <FolderKanbanIcon data-icon="inline-start" />
              <span>
                <strong>{item.name}</strong>
                <small>{item.environment}</small>
              </span>
              {item.id === project?.id ? <CheckIcon data-icon="inline-end" /> : null}
            </Button>
          ))}
        </nav>
        {projects.length ? <Separator /> : null}
        <div className="project-hover-card__footer">
          <Button type="button" variant="ghost" onClick={() => void navigate({ to: "/projects" })}>
            <Rows3Icon data-icon="inline-start" />
            所有项目
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void navigate({ to: "/projects/new" })}
          >
            <PlusIcon data-icon="inline-start" />
            创建项目
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
