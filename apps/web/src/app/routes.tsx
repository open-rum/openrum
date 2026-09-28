import { PlayCircle, WarningCircle } from "@phosphor-icons/react";
import { type QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { HTTPError, getSetupStatus, safeReturnTo, sessionQueryOptions } from "@/lib/auth/session";
import { LoginRoutePage } from "@/features/auth/LoginPage";
import { AwaitingAccessPage } from "@/features/auth/AwaitingAccessPage";
import { SetupPage } from "@/features/auth/SetupPage";
import { App } from "./App";
import { PlannedPage } from "./PlannedPage";
import { RouteLoading } from "./RouteLoading";
import { queryClient } from "./queryClient";

const OverviewPage = lazyRouteComponent(
  () => import("@/features/overview/OverviewPage"),
  "OverviewPage",
);
const AnalysisPage = lazyRouteComponent(
  () => import("@/features/analytics/AnalysisPage"),
  "AnalysisPage",
);
const FunnelsPage = lazyRouteComponent(
  () => import("@/features/analytics/FunnelsPage"),
  "FunnelsPage",
);
const PathsPage = lazyRouteComponent(() => import("@/features/analytics/PathsPage"), "PathsPage");
const RetentionPage = lazyRouteComponent(
  () => import("@/features/analytics/RetentionPage"),
  "RetentionPage",
);
const SessionsPage = lazyRouteComponent(
  () => import("@/features/sessions/SessionsPage"),
  "SessionsPage",
);
const SessionDetailPage = lazyRouteComponent(
  () => import("@/features/sessions/SessionDetailPage"),
  "SessionDetailPage",
);
const EventsPage = lazyRouteComponent(() => import("@/features/events/EventsPage"), "EventsPage");
const LogsPage = lazyRouteComponent(() => import("@/features/logs/LogsPage"), "LogsPage");
const OnboardingPage = lazyRouteComponent(
  () => import("@/features/onboarding/OnboardingPage"),
  "OnboardingPage",
);
const ProjectEntryPage = lazyRouteComponent(
  () => import("@/features/projects/ProjectEntryPage"),
  "ProjectEntryPage",
);
const ProjectListPage = lazyRouteComponent(
  () => import("@/features/projects/ProjectListPage"),
  "ProjectListPage",
);
const ProjectCreatePage = lazyRouteComponent(
  () => import("@/features/projects/ProjectCreatePage"),
  "ProjectCreatePage",
);
const IssuesPage = lazyRouteComponent(() => import("@/features/issues/IssuesPage"), "IssuesPage");
const IssueDetailPage = lazyRouteComponent(
  () => import("@/features/issues/IssueDetailPage"),
  "IssueDetailPage",
);
const ReleasesPage = lazyRouteComponent(
  () => import("@/features/releases/ReleasesPage"),
  "ReleasesPage",
);
const PerformancePage = lazyRouteComponent(
  () => import("@/features/performance/PerformancePage"),
  "PerformancePage",
);
const ApisPage = lazyRouteComponent(() => import("@/features/apis/ApisPage"), "ApisPage");
const UsagePage = lazyRouteComponent(() => import("@/features/usage/UsagePage"), "UsagePage");
const OrganizationUsagePage = lazyRouteComponent(
  () => import("@/features/usage/OrganizationUsagePage"),
  "OrganizationUsagePage",
);
const AlertsPage = lazyRouteComponent(() => import("@/features/alerts/AlertsPage"), "AlertsPage");
const ChannelsPage = lazyRouteComponent(
  () => import("@/features/settings/ChannelsPage"),
  "ChannelsPage",
);
const AccountPage = lazyRouteComponent(
  () => import("@/features/settings/AccountPage"),
  "AccountPage",
);
const MembersPage = lazyRouteComponent(
  () => import("@/features/settings/MembersPage"),
  "MembersPage",
);
const ProjectKeysRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectKeys"),
  "ProjectKeysRoute",
);
const ProjectSettingsRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectSettingsPage"),
  "ProjectSettingsRoute",
);
const ProjectFiltersRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectFiltersPage"),
  "ProjectFiltersRoute",
);
const ProjectURLRulesRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectURLRulesPage"),
  "ProjectURLRulesRoute",
);
const ProjectScrubbingRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectScrubbingPage"),
  "ProjectScrubbingRoute",
);
const ProjectQuotaRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectQuotaPage"),
  "ProjectQuotaRoute",
);
const ProjectSamplingRoute = lazyRouteComponent(
  () => import("@/features/settings/ProjectSamplingPage"),
  "ProjectSamplingRoute",
);
const AdminOverviewPage = lazyRouteComponent(
  () => import("@/features/admin/AdminOverviewPage"),
  "AdminOverviewPage",
);
const ObjectStoragePage = lazyRouteComponent(
  () => import("@/features/admin/ObjectStoragePage"),
  "ObjectStoragePage",
);
const DataRetentionPage = lazyRouteComponent(
  () => import("@/features/admin/DataRetentionPage"),
  "DataRetentionPage",
);
const AuditPage = lazyRouteComponent(() => import("@/features/admin/AuditPage"), "AuditPage");
const AuthenticationPage = lazyRouteComponent(
  () => import("@/features/admin/AuthenticationPage"),
  "AuthenticationPage",
);

type RouterContext = {
  queryClient: QueryClient;
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <PlannedPage
      title="页面不存在"
      description="当前地址没有对应页面，请返回数据大盘继续浏览。"
      icon={WarningCircle}
    />
  ),
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async ({ context }) => {
    const status = await getSetupStatus();
    if (!status.initialized) return;
    try {
      const user = await context.queryClient.fetchQuery(sessionQueryOptions());
      if (user.accessStatus === "pending") throw redirect({ to: "/awaiting-access" });
      throw redirect({ to: "/" });
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) {
        throw redirect({ to: "/login", search: { returnTo: undefined, expired: undefined } });
      }
      throw error;
    }
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (
    search: Record<string, unknown>,
  ): { returnTo?: string; expired?: boolean; error?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    expired: search.expired === true || search.expired === "1" ? true : undefined,
    error:
      search.error === "external" || search.error === "cancelled" || search.error === "expired"
        ? search.error
        : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const status = await getSetupStatus();
    if (!status.initialized) throw redirect({ to: "/setup" });
    try {
      const user = await context.queryClient.fetchQuery(sessionQueryOptions());
      if (user.accessStatus === "pending")
        throw redirect({ to: "/awaiting-access", search: { returnTo: search.returnTo } });
      throw redirect({ href: safeReturnTo(search.returnTo) });
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) return;
      throw error;
    }
  },
  component: LoginRoutePage,
});

const awaitingAccessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/awaiting-access",
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    try {
      const user = await context.queryClient.fetchQuery(sessionQueryOptions());
      if (user.accessStatus !== "pending") throw redirect({ href: safeReturnTo(search.returnTo) });
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) throw redirect({ to: "/login" });
      throw error;
    }
  },
  component: AwaitingAccessPage,
});

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  beforeLoad: async ({ context, location }) => {
    try {
      const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
      if (user.accessStatus === "pending")
        throw redirect({ to: "/awaiting-access", search: { returnTo: location.href } });
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) {
        throw redirect({
          to: "/login",
          search: { returnTo: location.href, expired: true },
        });
      }
      throw error;
    }
  },
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/",
  component: ProjectEntryPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects",
  component: ProjectListPage,
});

const projectCreateRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/new",
  component: ProjectCreatePage,
});

const projectAnalysisRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/analytics",
  component: AnalysisPage,
});

const funnelsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/funnels",
  component: FunnelsPage,
});

const projectFunnelsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/analytics/funnels",
  component: FunnelsPage,
});

const pathsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/paths",
  component: PathsPage,
});

const projectPathsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/analytics/paths",
  component: PathsPage,
});

const retentionRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/retention",
  component: RetentionPage,
});

const projectRetentionRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/analytics/retention",
  component: RetentionPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/sessions",
  component: SessionsPage,
});

const projectSessionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/sessions",
  component: SessionsPage,
});

const projectSessionDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/sessions/$sessionId",
  component: SessionDetailPage,
});

const legacyInsightsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/insights",
  beforeLoad: () => {
    throw redirect({ to: "/sessions" });
  },
});

const legacyProjectInsightsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/insights",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectId/sessions",
      params: { projectId: params.projectId },
    });
  },
});

const eventsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/events",
  component: EventsPage,
});

const projectEventsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/events",
  component: EventsPage,
});
const projectLogsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/logs",
  component: LogsPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/onboarding",
  component: OnboardingPage,
});

const projectOnboardingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/onboarding",
  component: OnboardingPage,
});

const projectOverviewRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/overview",
  component: OverviewPage,
});

const issuesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/issues",
  component: IssuesPage,
});

const projectIssuesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/issues",
  component: IssuesPage,
});

const issueDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/issues/$fingerprint",
  component: IssueDetailPage,
});

const releasesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/releases",
  component: ReleasesPage,
});

const projectReleasesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/releases",
  component: ReleasesPage,
});

const performanceRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/performance",
  component: PerformancePage,
});

const projectPerformanceRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/performance",
  component: PerformancePage,
});

const apisRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/apis",
  component: ApisPage,
});

const projectApisRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/apis",
  component: ApisPage,
});

const usageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/usage",
  component: OrganizationUsagePage,
});

const legacyProjectUsageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/usage",
  beforeLoad: ({ params, location }) => {
    throw redirect({
      href: `/settings/project/${encodeURIComponent(params.projectId)}/usage${location.searchStr}`,
    });
  },
});

const alertsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/alerts",
  component: AlertsPage,
});
const projectAlertsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/alerts",
  component: AlertsPage,
});
// Settings addresses carry their scope as a path segment — account, org, project or
// instance — so a settings link is unambiguous about which of the four it belongs to and
// survives being shared. The three separate navigations these replace had no such marker.

const requireInstanceRole = async ({ context }: { context: { queryClient: QueryClient } }) => {
  const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
  if (!user.instanceRole) throw redirect({ to: "/projects" });
};

const requireInstanceOwner = async ({ context }: { context: { queryClient: QueryClient } }) => {
  const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
  if (user.instanceRole !== "instance_owner") throw redirect({ to: "/projects" });
};

const settingsAccountRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/account",
  component: AccountPage,
});

const settingsMembersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/org/members",
  component: MembersPage,
});

const settingsChannelsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/org/channels",
  component: ChannelsPage,
});

const settingsProjectGeneralRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/general",
  component: ProjectSettingsRoute,
});

const settingsProjectKeysRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/keys",
  component: ProjectKeysRoute,
});

const settingsProjectFiltersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/filters",
  component: ProjectFiltersRoute,
});

const settingsProjectURLRulesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/url-rules",
  component: ProjectURLRulesRoute,
});

const settingsProjectScrubbingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/scrubbing",
  component: ProjectScrubbingRoute,
});

const settingsProjectQuotaRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/quota",
  component: ProjectQuotaRoute,
});

const settingsProjectSamplingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/sampling",
  component: ProjectSamplingRoute,
});

const settingsProjectUsageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/project/$projectId/usage",
  component: UsagePage,
});

const settingsInstanceRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/instance",
  beforeLoad: requireInstanceRole,
  component: AdminOverviewPage,
});

const settingsInstanceRetentionRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/instance/retention",
  beforeLoad: requireInstanceRole,
  component: DataRetentionPage,
});

const settingsInstanceObjectStorageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/instance/object-storage",
  beforeLoad: requireInstanceRole,
  component: ObjectStoragePage,
});

const settingsInstanceAuthenticationRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/instance/authentication",
  beforeLoad: requireInstanceOwner,
  component: AuthenticationPage,
});

const settingsInstanceAuditRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/instance/audit",
  beforeLoad: requireInstanceRole,
  component: AuditPage,
});

// The old addresses are in the documentation, in bookmarks and in links people have sent
// each other, so every one of them keeps resolving. They redirect rather than render, so
// there is exactly one canonical address per setting and the rail never highlights two.
const legacySettingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({ to: "/settings/org/members" });
  },
});

const legacyChannelsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/channels",
  beforeLoad: () => {
    throw redirect({ to: "/settings/org/channels" });
  },
});

const legacyAccountRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/account",
  beforeLoad: () => {
    throw redirect({ to: "/settings/account" });
  },
});

const legacyAdminRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin",
  beforeLoad: () => {
    throw redirect({ to: "/settings/instance" });
  },
});

const legacyAdminObjectStorageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin/object-storage",
  beforeLoad: () => {
    throw redirect({ to: "/settings/instance/object-storage" });
  },
});

const legacyAdminDataRetentionRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin/data-retention",
  beforeLoad: () => {
    throw redirect({ to: "/settings/instance/retention" });
  },
});

const legacyAdminAuditRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin/audit",
  beforeLoad: () => {
    throw redirect({ to: "/settings/instance/audit" });
  },
});

const legacyProjectSettingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/project/$projectId/general",
      params: { projectId: params.projectId },
    });
  },
});

const legacyProjectKeysRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/keys",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/project/$projectId/keys",
      params: { projectId: params.projectId },
    });
  },
});

const legacyProjectFiltersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/filters",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/project/$projectId/filters",
      params: { projectId: params.projectId },
    });
  },
});

const legacyProjectURLRulesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/url-rules",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/project/$projectId/url-rules",
      params: { projectId: params.projectId },
    });
  },
});

const legacyProjectScrubbingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/scrubbing",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/project/$projectId/scrubbing",
      params: { projectId: params.projectId },
    });
  },
});

const legacyProjectQuotaRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/quota",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/project/$projectId/quota",
      params: { projectId: params.projectId },
    });
  },
});

const plannedRoutes = [
  {
    path: "/replays",
    title: "回放列表",
    description: "按用户、页面、异常和自定义属性筛选并重放真实会话。",
    icon: PlayCircle,
  },
] as const;

// The generator is a development affordance, not a product surface. Declaring
// the lazy import inside the branch means a production bundle contains no
// reference to it at all, rather than shipping a chunk that is never loaded.
const devDataRoutes = import.meta.env.DEV
  ? (() => {
      const DevDataPage = lazyRouteComponent(
        () => import("@/features/devdata/DevDataPage"),
        "DevDataPage",
      );
      return [
        createRoute({
          getParentRoute: () => protectedRoute,
          path: "/dev-data",
          component: DevDataPage,
        }),
        createRoute({
          getParentRoute: () => protectedRoute,
          path: "/projects/$projectId/dev-data",
          component: DevDataPage,
        }),
      ];
    })()
  : [];

const protectedChildren = plannedRoutes.map(({ path, title, description, icon }) =>
  createRoute({
    getParentRoute: () => protectedRoute,
    path,
    component: () => <PlannedPage title={title} description={description} icon={icon} />,
  }),
);

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  awaitingAccessRoute,
  protectedRoute.addChildren([
    indexRoute,
    projectsRoute,
    projectCreateRoute,
    projectAnalysisRoute,
    funnelsRoute,
    projectFunnelsRoute,
    pathsRoute,
    projectPathsRoute,
    retentionRoute,
    projectRetentionRoute,
    sessionsRoute,
    projectSessionsRoute,
    projectSessionDetailRoute,
    legacyInsightsRoute,
    legacyProjectInsightsRoute,
    eventsRoute,
    projectEventsRoute,
    projectLogsRoute,
    onboardingRoute,
    projectOnboardingRoute,
    projectOverviewRoute,
    issuesRoute,
    projectIssuesRoute,
    issueDetailRoute,
    releasesRoute,
    projectReleasesRoute,
    performanceRoute,
    projectPerformanceRoute,
    apisRoute,
    projectApisRoute,
    usageRoute,
    legacyProjectUsageRoute,
    alertsRoute,
    projectAlertsRoute,
    settingsAccountRoute,
    settingsMembersRoute,
    settingsChannelsRoute,
    settingsProjectGeneralRoute,
    settingsProjectKeysRoute,
    settingsProjectFiltersRoute,
    settingsProjectURLRulesRoute,
    settingsProjectScrubbingRoute,
    settingsProjectQuotaRoute,
    settingsProjectSamplingRoute,
    settingsProjectUsageRoute,
    settingsInstanceRoute,
    settingsInstanceRetentionRoute,
    settingsInstanceObjectStorageRoute,
    settingsInstanceAuthenticationRoute,
    settingsInstanceAuditRoute,
    legacySettingsRoute,
    legacyChannelsRoute,
    legacyAccountRoute,
    legacyAdminRoute,
    legacyAdminObjectStorageRoute,
    legacyAdminDataRetentionRoute,
    legacyAdminAuditRoute,
    legacyProjectSettingsRoute,
    legacyProjectKeysRoute,
    legacyProjectFiltersRoute,
    legacyProjectURLRulesRoute,
    legacyProjectScrubbingRoute,
    legacyProjectQuotaRoute,
    ...devDataRoutes,
    ...protectedChildren,
  ]),
]);

// Analysis pages keep their filters in the query string and commit them with
// history.pushState. The router reads every history entry as a navigation and
// answers by scrolling to the top, so opening an API or Route detail drawer
// threw the page back to the header first. Scrolling to the top belongs to a
// change of route; staying put belongs to a change of filter. Returning false
// skips restoration too, which is what we want because the rendered route is
// the one already on screen.
let scrolledPathname = typeof window === "undefined" ? "" : window.location.pathname;

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingComponent: RouteLoading,
  scrollRestoration: ({ location }) => {
    const routeChanged = location.pathname !== scrolledPathname;
    scrolledPathname = location.pathname;
    return routeChanged;
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
