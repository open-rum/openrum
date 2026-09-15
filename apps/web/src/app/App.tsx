import {
  Bell,
  ChartPieSlice,
  CaretUpDown,
  Gauge,
  ListBullets,
  Pulse,
  SidebarSimple,
  Sliders,
  SquaresFour,
  WarningCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactElement } from "react";
import { LogsIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectSwitcher } from "@/features/projects/ProjectSwitcher";
import {
  AnalysisContextProvider,
  AnalysisTimeFilter,
  isAnalysisRoute,
  useAnalysisContextState,
} from "@/features/filters/AnalysisContextBar";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { logout, sessionQueryOptions } from "@/lib/auth/session";
import { rememberProject, selectProject } from "@/lib/projects/currentProject";
import { AppShell } from "./AppShell";
import { AppStatusBar } from "./AppStatusBar";

const SIDEBAR_STORAGE_KEY = "openrum-sidebar-collapsed";

function formatEnvironmentLabel(value?: string) {
  if (!value) return "全部环境";
  if (value === "production") return "Production";
  if (value === "test") return "Test";
  return value;
}

const primaryNavigation = [
  { label: "数据大盘", icon: SquaresFour, to: "/projects/$projectId/overview" },
  { label: "分析", icon: ChartPieSlice, to: "/projects/$projectId/analytics" },
  { label: "错误", icon: WarningCircle, to: "/projects/$projectId/issues" },
  { label: "日志", icon: LogsIcon, to: "/projects/$projectId/logs" },
  { label: "性能", icon: Gauge, to: "/projects/$projectId/performance" },
  { label: "事件", icon: ListBullets, to: "/projects/$projectId/events" },
  { label: "API", icon: Pulse, to: "/projects/$projectId/apis" },
  { label: "告警", icon: Bell, to: "/projects/$projectId/alerts" },
  { label: "会话", icon: UsersThree, to: "/projects/$projectId/sessions" },
] as const;

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
  );
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId?: string };
  const pathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname ?? state.location.pathname,
  });
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQueryOptions());
  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizationsQuery.data?.organizations[0];
  const projectsQuery = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const projects = projectsQuery.data?.projects ?? [];
  const project = organization
    ? selectProject(projects, organization.id, routeProjectId)
    : undefined;
  const analysisContext = useAnalysisContextState(project, isAnalysisRoute(pathname));
  const currentEnvironment = formatEnvironmentLabel(analysisContext?.environment);
  const projectSettingsActive = Boolean(
    routeProjectId &&
    (pathname.includes("/settings") ||
      pathname.includes("/onboarding") ||
      pathname.includes("/releases") ||
      pathname.includes("/usage") ||
      pathname.includes("/dev-data")),
  );
  useEffect(() => {
    if (project) rememberProject(project);
  }, [project]);
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    const toggleSidebar = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      setSidebarCollapsed((collapsed) => !collapsed);
    };
    window.addEventListener("keydown", toggleSidebar);
    return () => window.removeEventListener("keydown", toggleSidebar);
  }, []);
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.replace("/login");
    },
  });

  return (
    <AnalysisContextProvider value={analysisContext}>
      <AppShell
        sidebarCollapsed={sidebarCollapsed}
        statusBar={
          <AppStatusBar
            context={
              analysisContext && isAnalysisRoute(pathname) ? <AnalysisTimeFilter /> : undefined
            }
            navigationToggle={
              <Button
                className="app-status-bar__sidebar-toggle"
                type="button"
                variant="ghost"
                size="icon"
                aria-controls="app-sidebar"
                aria-expanded={!sidebarCollapsed}
                aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
                title={`${sidebarCollapsed ? "展开" : "收起"}侧边栏（⌘/Ctrl+B）`}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                <SidebarSimple weight="regular" />
              </Button>
            }
          />
        }
        navigation={
          <TooltipProvider>
            <div className="sidebar__brand-row">
              <ProjectSwitcher
                organization={organization}
                projects={projects}
                project={project}
                loading={organizationsQuery.isLoading || projectsQuery.isLoading}
                currentEnvironment={analysisContext?.environment}
                onEnvironmentChange={
                  routeProjectId && analysisContext
                    ? (environment) => analysisContext.update({ environment })
                    : undefined
                }
              >
                <Link
                  className="brand"
                  to="/projects"
                  aria-label={
                    routeProjectId && project
                      ? `切换项目，当前为 ${project.name}，环境 ${currentEnvironment}`
                      : "OpenRUM 项目列表"
                  }
                >
                  <BrandMark size="nav" />
                  <span className="brand__identity">
                    {routeProjectId && project ? (
                      <>
                        <strong>{project.name}</strong>
                        <small>{currentEnvironment}</small>
                      </>
                    ) : (
                      <strong>OpenRUM</strong>
                    )}
                  </span>
                  <CaretUpDown className="brand__switcher-icon" aria-hidden="true" />
                </Link>
              </ProjectSwitcher>
            </div>

            <nav className="sidebar__nav" aria-label="主导航">
              {primaryNavigation.map(({ label, icon: Icon, to }) => (
                <SidebarTooltip key={to} label={label} enabled={sidebarCollapsed}>
                  {project ? (
                    <Link
                      className="nav-item"
                      to={to}
                      params={{ projectId: project.id }}
                      activeProps={{ className: "is-active" }}
                      aria-label={label}
                    >
                      <Icon size={17} />
                      <span>{label}</span>
                    </Link>
                  ) : (
                    <Link className="nav-item" to="/projects/new" aria-label={label}>
                      <Icon size={17} />
                      <span>{label}</span>
                    </Link>
                  )}
                </SidebarTooltip>
              ))}
              <SidebarTooltip label="项目设置" enabled={sidebarCollapsed}>
                {project ? (
                  <Link
                    className={projectSettingsActive ? "nav-item is-active" : "nav-item"}
                    to="/projects/$projectId/settings"
                    params={{ projectId: project.id }}
                    aria-label="项目设置"
                  >
                    <Sliders size={17} />
                    <span>项目设置</span>
                  </Link>
                ) : (
                  <Link className="nav-item" to="/projects/new" aria-label="项目设置">
                    <Sliders size={17} />
                    <span>项目设置</span>
                  </Link>
                )}
              </SidebarTooltip>
            </nav>

            <div className="sidebar__footer">
              <div className="account-panel">
                <AccountMenu
                  displayName={user.displayName}
                  email={user.email}
                  signingOut={signOut.isPending}
                  onSignOut={() => signOut.mutate()}
                />
              </div>
              {signOut.error ? <p className="sidebar__error">退出失败，请重试。</p> : null}
            </div>
          </TooltipProvider>
        }
      />
    </AnalysisContextProvider>
  );
}

function SidebarTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
