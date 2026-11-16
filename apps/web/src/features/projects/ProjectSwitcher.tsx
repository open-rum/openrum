import { lazy, Suspense, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, PlusIcon, Rows3Icon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { projectSwitchDestination } from "./projectSwitchDestination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  canManageMembers,
  getReportedEnvironments,
  type Organization,
  type Project,
} from "@/lib/api/projects";
import { environmentLabel, projectEnvironments } from "@/lib/projects/environments";
import { rememberProject } from "@/lib/projects/currentProject";
import { ProjectPlatformIcon, getProjectPlatform } from "./projectPlatforms";

// Only people who can invite ever open it, and the menu is on every project page, so the
// dialog stays out of the first load.
const InviteDialog = lazy(() =>
  import("@/features/invitations/InviteDialog").then((module) => ({
    default: module.InviteDialog,
  })),
);

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
  // The invitation dialog stays mounted independently of the project picker.
  const [inviting, setInviting] = useState(false);
  // Mounted from the first click on, so closing it can still play its exit.
  const [inviteLoaded, setInviteLoaded] = useState(false);
  const canInvite = organization ? canManageMembers(organization.role) : false;
  const [open, setOpen] = useState(false);
  const [choosingEnvironment, setChoosingEnvironment] = useState(false);
  // Every project accepts the four fixed environments; offer the ones that have data.
  const reported = useQuery({
    queryKey: ["reported-environments", project?.id],
    queryFn: ({ signal }) => getReportedEnvironments(project!.id, signal),
    enabled: Boolean(project && onEnvironmentChange),
    staleTime: 60_000,
  });
  const reportedNames = new Set(reported.data?.environments.map((item) => item.name));
  const environments = projectEnvironments
    .map((item) => item.id)
    .filter((name) => reportedNames.has(name) || name === currentEnvironment);

  return (
    <>
      <Popover open={open || choosingEnvironment} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          className="project-hover-card max-h-[calc(100dvh-2rem)] overflow-y-auto"
          side="bottom"
          align="start"
          sideOffset={8}
        >
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
                  setOpen(false);
                  void navigate(
                    projectSwitchDestination(
                      item.id,
                      window.location.pathname,
                      window.location.search,
                    ),
                  );
                }}
              >
                <ProjectPlatformIcon platform={item.sdkPlatform} data-icon="inline-start" />
                <span>
                  <strong>{item.name}</strong>
                  <small>{getProjectPlatform(item.sdkPlatform).label}</small>
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
                  <small>
                    {reported.isSuccess && !environments.length ? "尚无上报数据" : "按上报数据列出"}
                  </small>
                </div>
                <Select
                  open={choosingEnvironment}
                  onOpenChange={setChoosingEnvironment}
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
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/projects" });
              }}
            >
              <Rows3Icon data-icon="inline-start" />
              所有项目
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/projects/new" });
              }}
            >
              <PlusIcon data-icon="inline-start" />
              创建项目
            </Button>
            {canInvite ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInviteLoaded(true);
                  setInviting(true);
                }}
              >
                <UserPlusIcon data-icon="inline-start" />
                邀请成员
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {organization && canInvite && inviteLoaded ? (
        <Suspense fallback={null}>
          <InviteDialog organization={organization} open={inviting} onOpenChange={setInviting} />
        </Suspense>
      ) : null}
    </>
  );
}

function formatEnvironmentLabel(value?: string) {
  if (!value) return "全部环境";
  return `${environmentLabel(value)} · ${value}`;
}
