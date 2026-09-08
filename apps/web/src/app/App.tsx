import {
  Bell,
  ChartBar,
  ChartPieSlice,
  Flask,
  Gauge,
  GearSix,
  ListBullets,
  Package,
  Plug,
  Pulse,
  ShieldCheck,
  SidebarSimple,
  Sliders,
  SquaresFour,
  WarningCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectSwitcher } from "@/features/projects/ProjectSwitcher";
import {
  AnalysisContextControls,
  AnalysisContextProvider,
  isAnalysisRoute,
  useAnalysisContextState,
} from "@/features/filters/AnalysisContextBar";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { logout, sessionQueryOptions } from "@/lib/auth/session";
import { rememberProject, selectProject } from "@/lib/projects/currentProject";
import { AppShell } from "./AppShell";
import { AppStatusBar } from "./AppStatusBar";

const SIDEBAR_STORAGE_KEY = "openrum-sidebar-collapsed";

const primaryNavigation = [
  { label: "数据大盘", icon: SquaresFour, to: "/projects/$projectId/overview" },
  { label: "分析", icon: ChartPieSlice, to: "/projects/$projectId/analytics" },
  { label: "错误", icon: WarningCircle, to: "/projects/$projectId/issues" },
  { label: "性能", icon: Gauge, to: "/projects/$projectId/performance" },
  { label: "事件", icon: ListBullets, to: "/projects/$projectId/events" },
  { label: "API", icon: Pulse, to: "/projects/$projectId/apis" },
  { label: "告警", icon: Bell, to: "/projects/$projectId/alerts" },
  { label: "会话", icon: UsersThree, to: "/projects/$projectId/sessions" },
] as const;

const utilityNavigation = [
  { label: "接入", icon: Plug, to: "/projects/$projectId/onboarding" },
  { label: "发布", icon: Package, to: "/projects/$projectId/releases" },
  { label: "用量", icon: ChartBar, to: "/projects/$projectId/usage" },
  { label: "项目设置", icon: Sliders, to: "/projects/$projectId/settings" },
  // Only reachable in a development build, matching the route registration.
  ...(import.meta.env.DEV
    ? ([{ label: "造数据", icon: Flask, to: "/projects/$projectId/dev-data" }] as const)
    : []),
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
              project && analysisContext && isAnalysisRoute(pathname) ? (
                <AnalysisContextControls context={analysisContext} project={project} />
              ) : undefined
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
              >
                <Link
                  className="brand"
                  to="/projects"
                  aria-label={project ? `OpenRUM，当前项目 ${project.name}` : "OpenRUM 项目"}
                >
                  <BrandMark />
                  <span>OpenRUM</span>
                </Link>
              </ProjectSwitcher>
              <Button
                className="sidebar__toggle"
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
              <SidebarTooltip label="设置" enabled={sidebarCollapsed}>
                <Link
                  className="nav-item"
                  to="/settings"
                  activeProps={{ className: "is-active" }}
                  aria-label="设置"
                >
                  <GearSix size={17} />
                  <span>设置</span>
                </Link>
              </SidebarTooltip>
              {user.instanceRole ? (
                <SidebarTooltip label="系统管理" enabled={sidebarCollapsed}>
                  <Link
                    className="nav-item"
                    to="/admin"
                    activeProps={{ className: "is-active" }}
                    aria-label="系统管理"
                  >
                    <ShieldCheck size={17} />
                    <span>系统管理</span>
                  </Link>
                </SidebarTooltip>
              ) : null}
            </nav>

            <div className="sidebar__footer">
              <nav className="sidebar__utility-nav" aria-label="项目管理">
                <small>项目管理</small>
                {utilityNavigation.map(({ label, icon: Icon, to }) => (
                  <SidebarTooltip key={to} label={label} enabled={sidebarCollapsed}>
                    {project ? (
                      <Link
                        className="nav-item nav-item--utility"
                        to={to}
                        params={{ projectId: project.id }}
                        aria-label={label}
                      >
                        <Icon size={16} />
                        <span>{label}</span>
                      </Link>
                    ) : (
                      <Link
                        className="nav-item nav-item--utility"
                        to="/projects/new"
                        aria-label={label}
                      >
                        <Icon size={16} />
                        <span>{label}</span>
                      </Link>
                    )}
                  </SidebarTooltip>
                ))}
              </nav>
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
