import type { ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, FolderKanbanIcon, PlusIcon, Rows3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Organization, Project } from "@/lib/api/projects";
import { rememberProject } from "@/lib/projects/currentProject";

export function ProjectSwitcher({
  organization,
  projects,
  project,
  loading,
  currentEnvironment,
  onEnvironmentChange,
  children,
}: {
  organization?: Organization;
  projects: Project[];
  project?: Project;
  loading: boolean;
  currentEnvironment?: string;
  onEnvironmentChange?: (environment?: string) => void;
  children: ReactElement;
}) {
  const navigate = useNavigate();
  const environments = project?.environments?.length
    ? project.environments
    : project
      ? [project.environment]
      : [];

  return (
    <HoverCard openDelay={120} closeDelay={240}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="project-hover-card" side="right" align="start" sideOffset={8}>
        <div className="project-hover-card__heading">
          <span>
            <small>当前组织</small>
            <strong>{organization?.name ?? "未命名"}</strong>
          </span>
          <small>{loading ? "加载项目…" : `${projects.length} 个项目`}</small>
        </div>
        <Separator />
        <nav className="project-hover-card__list" aria-label="切换项目">
          {projects.map((item) => (
            <Button
              key={item.id}
              className="project-hover-card__item"
              type="button"
              variant="ghost"
              size="sm"
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
                <small>{item.slug}</small>
              </span>
              {item.id === project?.id ? <CheckIcon data-icon="inline-end" /> : null}
            </Button>
          ))}
        </nav>
        {project && onEnvironmentChange ? (
          <>
            <Separator />
            <div className="project-hover-card__environment">
              <div className="project-hover-card__environment-heading">
                <span>环境</span>
                <small>默认 {formatEnvironmentLabel(project.environment)}</small>
              </div>
              <Select
                value={currentEnvironment ?? "all"}
                onValueChange={(value) => {
                  onEnvironmentChange(value === "all" ? undefined : value);
                }}
              >
                <SelectTrigger className="w-full" size="sm" aria-label="切换数据环境">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="all">全部环境</SelectItem>
                    {environments.map((environment) => (
                      <SelectItem key={environment} value={environment}>
                        {formatEnvironmentLabel(environment)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
        {projects.length || (project && onEnvironmentChange) ? <Separator /> : null}
        <div className="project-hover-card__footer">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: "/projects" })}
          >
            <Rows3Icon data-icon="inline-start" />
            所有项目
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
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

function formatEnvironmentLabel(value?: string) {
  if (!value) return "全部环境";
  if (value === "production") return "Production";
  if (value === "test") return "Test";
  return value;
}
