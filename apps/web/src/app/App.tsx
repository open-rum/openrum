import {
  Bell,
  ChartPieSlice,
  CaretRight,
  CaretUpDown,
  Gauge,
  ListBullets,
  Pulse,
  Rocket,
  SidebarSimple,
  Sliders,
  SquaresFour,
  WarningCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { LogsIcon, ChartColumnIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectSwitcher } from "@/features/projects/ProjectSwitcher";
import { SettingsNav } from "@/features/settings/SettingsNav";
import {
  AnalysisContextProvider,
  AnalysisTimeFilter,
  isAnalysisRoute,
  useAnalysisContextState,
} from "@/features/filters/AnalysisContextBar";
import { listOrganizations, listProjects } from "@/lib/api/projects";
import { storagePressureQueryOptions } from "@/lib/api/storagePressure";
import { getConnectionStatus } from "@/lib/api/client";
import { logout, sessionQueryOptions } from "@/lib/auth/session";
import { rememberProject, selectProject } from "@/lib/projects/currentProject";
import { AppShell } from "./AppShell";
import { AppStatusBar } from "./AppStatusBar";
import { StoragePressureBanner } from "./StoragePressureBanner";
import { isPipelineDelayed } from "./pipelineStatus";

const SIDEBAR_STORAGE_KEY = "openrum-sidebar-collapsed";
const DevDataQuickEntry = import.meta.env.DEV
  ? lazy(() =>
      import("@/features/devdata/DevDataPage").then((module) => ({
        default: module.DevDataQuickEntry,
      })),
    )
  : null;

function isSecondaryNavigationPath(pathname: string) {
  return (
    pathname.startsWith("/settings") ||
    pathname.includes("/onboarding") ||
    pathname.includes("/dev-data")
  );
}

function formatEnvironmentLabel(value?: string) {
  if (!value) return "全部环境";
  if (value === "production") return "Production";
  if (value === "test") return "Test";
  return value;
}

const primaryNavigation = [
  {
    label: "仪表盘",
    icon: SquaresFour,
    to: "/projects/$projectId/overview",
    preserveAnalysisContext: true,
  },
  {
    label: "分析",
    icon: ChartPieSlice,
    to: "/projects/$projectId/analytics",
    preserveAnalysisContext: true,
  },
  {
    label: "错误",
    icon: WarningCircle,
    to: "/projects/$projectId/issues",
    preserveAnalysisContext: true,
  },
  {
    label: "日志",
    icon: LogsIcon,
    to: "/projects/$projectId/logs",
    preserveAnalysisContext: true,
  },
  {
    label: "性能",
    icon: Gauge,
    to: "/projects/$projectId/performance",
    preserveAnalysisContext: true,
  },
  {
    label: "事件",
    icon: ListBullets,
    to: "/projects/$projectId/events",
    preserveAnalysisContext: true,
  },
  {
    label: "API",
    icon: Pulse,
    to: "/projects/$projectId/apis",
    preserveAnalysisContext: true,
  },
  { label: "告警", icon: Bell, to: "/projects/$projectId/alerts" },
  {
    label: "会话",
    icon: UsersThree,
    to: "/projects/$projectId/sessions",
    preserveAnalysisContext: true,
  },
  { label: "发布", icon: Rocket, to: "/projects/$projectId/releases" },
] as const;

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () =>
      !isSecondaryNavigationPath(window.location.pathname) &&
      window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
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
  const connectionStatusQuery = useQuery({
    queryKey: ["connection-status", routeProjectId],
    queryFn: ({ signal }) => getConnectionStatus(routeProjectId!, signal),
    enabled: Boolean(routeProjectId),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const storagePressureQuery = useQuery(storagePressureQueryOptions());
  const analysisContext = useAnalysisContextState(project, isAnalysisRoute(pathname));
  const currentEnvironment = formatEnvironmentLabel(analysisContext?.environment);
  const settingsActive = isSecondaryNavigationPath(pathname);
  const [previousSettingsActive, setPreviousSettingsActive] = useState(settingsActive);
  if (settingsActive !== previousSettingsActive) {
    setPreviousSettingsActive(settingsActive);
    if (settingsActive && sidebarCollapsed) setSidebarCollapsed(false);
  }
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
        banner={
          <StoragePressureBanner
            pressure={storagePressureQuery.data}
            canRecover={user.instanceRole === "instance_owner"}
          />
        }
        floatingTools={
          DevDataQuickEntry ? (
            <Suspense fallback={null}>
              <DevDataQuickEntry projects={projects} project={project} />
            </Suspense>
          ) : undefined
        }
        statusBar={
          <AppStatusBar
            dataDelayed={isPipelineDelayed(connectionStatusQuery.data)}
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
              {routeProjectId && project ? (
                <ProjectSwitcher
                  organization={organization}
                  projects={projects}
                  project={project}
                  loading={organizationsQuery.isLoading || projectsQuery.isLoading}
                  currentEnvironment={analysisContext?.environment}
                  onEnvironmentChange={
                    analysisContext
                      ? (environment) => analysisContext.update({ environment })
                      : undefined
                  }
                >
                  <Link
                    className="brand"
                    to="/projects"
                    aria-label={`切换项目，当前为 ${project.name}，环境 ${currentEnvironment}`}
                  >
                    <BrandMark size="lockup" />
                    <span className="brand__identity">
                      <strong>{project.name}</strong>
                      <small>{currentEnvironment}</small>
                    </span>
                    <CaretUpDown className="brand__switcher-icon" aria-hidden="true" />
                  </Link>
                </ProjectSwitcher>
              ) : (
                <Link className="brand" to="/projects" aria-label="OpenRUM 项目列表">
                  <BrandMark size="lockup" />
                  <span className="brand__identity brand__identity--product">
                    <strong>OpenRUM</strong>
                  </span>
                </Link>
              )}
            </div>

            <div
              className="sidebar-nav-switcher"
              data-level={settingsActive ? "settings" : "primary"}
            >
              <div className="sidebar-nav-switcher__track">
                <div
                  className="sidebar-nav-switcher__panel"
                  aria-hidden={settingsActive}
                  inert={settingsActive ? true : undefined}
                >
                  <nav className="sidebar__nav" aria-label="主导航">
                    {primaryNavigation.map((item) => {
                      const { label, icon: Icon, to } = item;
                      const sharedAnalysisSearch =
                        "preserveAnalysisContext" in item &&
                        item.preserveAnalysisContext &&
                        analysisContext
                          ? {
                              from: analysisContext.from.toISOString(),
                              to: analysisContext.to.toISOString(),
                              timePreset: analysisContext.timePreset,
                              environment: analysisContext.environment,
                            }
                          : undefined;
                      return (
                        <SidebarTooltip key={to} label={label} enabled={sidebarCollapsed}>
                          {project ? (
                            <Link
                              className="nav-item"
                              to={to}
                              params={{ projectId: project.id }}
                              search={sharedAnalysisSearch}
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
                      );
                    })}
                  </nav>
                </div>

                <div
                  className="sidebar-nav-switcher__panel sidebar-nav-switcher__panel--settings"
                  aria-hidden={!settingsActive}
                  inert={!settingsActive ? true : undefined}
                >
                  <SettingsNav
                    organizationName={organization?.name}
                    project={project}
                    showInstance={Boolean(user.instanceRole)}
                    instanceOwner={user.instanceRole === "instance_owner"}
                  />
                </div>
              </div>
            </div>

            <div className="sidebar__footer">
              <nav className="sidebar__utility-nav" aria-label="设置与快捷入口">
                <SidebarTooltip label="用量统计" enabled={sidebarCollapsed}>
                  <Link
                    className="nav-item nav-item--utility"
                    to="/usage"
                    activeProps={{ className: "is-active" }}
                    aria-label="用量统计"
                  >
                    <ChartColumnIcon size={17} />
                    <span>用量统计</span>
                  </Link>
                </SidebarTooltip>
                <SidebarTooltip label="设置" enabled={sidebarCollapsed}>
                  {project ? (
                    <Link
                      className="nav-item nav-item--utility"
                      to="/settings/project/$projectId/general"
                      params={{ projectId: project.id }}
                      aria-label="设置"
                    >
                      <Sliders size={17} />
                      <span>设置</span>
                      <CaretRight
                        className="nav-item__next"
                        size={14}
                        weight="bold"
                        aria-hidden="true"
                      />
                    </Link>
                  ) : (
                    <Link
                      className="nav-item nav-item--utility"
                      to="/settings/account"
                      aria-label="设置"
                    >
                      <Sliders size={17} />
                      <span>设置</span>
                      <CaretRight
                        className="nav-item__next"
                        size={14}
                        weight="bold"
                        aria-hidden="true"
                      />
                    </Link>
                  )}
                </SidebarTooltip>
              </nav>
              <div className="account-panel">
                <AccountMenu
                  displayName={user.displayName}
                  email={user.email}
                  signingOut={signOut.isPending}
                  onSignOut={() => signOut.mutate()}
                  showInstanceSettings={Boolean(user.instanceRole)}
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
