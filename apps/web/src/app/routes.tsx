/* eslint-disable react-refresh/only-export-components -- router-owned lazy boundaries are not Fast Refresh modules */
import { PlayCircle, WarningCircle } from "@phosphor-icons/react";
import { lazy } from "react";
import { type QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { HTTPError, getSetupStatus, safeReturnTo, sessionQueryOptions } from "@/lib/auth/session";
import { LoginRoutePage } from "@/features/auth/LoginPage";
import { SetupPage } from "@/features/auth/SetupPage";
import { App } from "./App";
import { PlannedPage } from "./PlannedPage";
import { queryClient } from "./queryClient";

const OverviewPage = lazy(() =>
  import("@/features/overview/OverviewPage").then((module) => ({ default: module.OverviewPage })),
);
const AnalysisPage = lazy(() =>
  import("@/features/analytics/AnalysisPage").then((module) => ({ default: module.AnalysisPage })),
);
const FunnelsPage = lazy(() =>
  import("@/features/analytics/FunnelsPage").then((module) => ({ default: module.FunnelsPage })),
);
const PathsPage = lazy(() =>
  import("@/features/analytics/PathsPage").then((module) => ({ default: module.PathsPage })),
);
const RetentionPage = lazy(() =>
  import("@/features/analytics/RetentionPage").then((module) => ({
    default: module.RetentionPage,
  })),
);
const SessionsPage = lazy(() =>
  import("@/features/sessions/SessionsPage").then((module) => ({ default: module.SessionsPage })),
);
const SessionDetailPage = lazy(() =>
  import("@/features/sessions/SessionDetailPage").then((module) => ({
    default: module.SessionDetailPage,
  })),
);
const EventsPage = lazy(() =>
  import("@/features/events/EventsPage").then((module) => ({ default: module.EventsPage })),
);
const LogsPage = lazy(() =>
  import("@/features/logs/LogsPage").then((module) => ({ default: module.LogsPage })),
);
const OnboardingPage = lazy(() =>
  import("@/features/onboarding/OnboardingPage").then((module) => ({
    default: module.OnboardingPage,
  })),
);
const ProjectEntryPage = lazy(() =>
  import("@/features/projects/ProjectEntryPage").then((module) => ({
    default: module.ProjectEntryPage,
  })),
);
const ProjectListPage = lazy(() =>
  import("@/features/projects/ProjectListPage").then((module) => ({
    default: module.ProjectListPage,
  })),
);
const ProjectCreatePage = lazy(() =>
  import("@/features/projects/ProjectCreatePage").then((module) => ({
    default: module.ProjectCreatePage,
  })),
);
const IssuesPage = lazy(() =>
  import("@/features/issues/IssuesPage").then((module) => ({ default: module.IssuesPage })),
);
const IssueDetailPage = lazy(() =>
  import("@/features/issues/IssueDetailPage").then((module) => ({
    default: module.IssueDetailPage,
  })),
);
const ReleasesPage = lazy(() =>
  import("@/features/releases/ReleasesPage").then((module) => ({ default: module.ReleasesPage })),
);
const PerformancePage = lazy(() =>
  import("@/features/performance/PerformancePage").then((module) => ({
    default: module.PerformancePage,
  })),
);
const ApisPage = lazy(() =>
  import("@/features/apis/ApisPage").then((module) => ({ default: module.ApisPage })),
);
const UsagePage = lazy(() =>
  import("@/features/usage/UsagePage").then((module) => ({ default: module.UsagePage })),
);
const AlertsPage = lazy(() =>
  import("@/features/alerts/AlertsPage").then((module) => ({ default: module.AlertsPage })),
);
const ChannelsPage = lazy(() =>
  import("@/features/settings/ChannelsPage").then((module) => ({ default: module.ChannelsPage })),
);
const AccountPage = lazy(() =>
  import("@/features/settings/AccountPage").then((module) => ({ default: module.AccountPage })),
);
const MembersPage = lazy(() =>
  import("@/features/settings/MembersPage").then((module) => ({ default: module.MembersPage })),
);
const ProjectKeysRoute = lazy(() =>
  import("@/features/settings/ProjectKeys").then((module) => ({
    default: module.ProjectKeysRoute,
  })),
);
const ProjectSettingsRoute = lazy(() =>
  import("@/features/settings/ProjectSettingsPage").then((module) => ({
    default: module.ProjectSettingsRoute,
  })),
);
const ProjectFiltersRoute = lazy(() =>
  import("@/features/settings/ProjectFiltersPage").then((module) => ({
    default: module.ProjectFiltersRoute,
  })),
);
const ProjectURLRulesRoute = lazy(() =>
  import("@/features/settings/ProjectURLRulesPage").then((module) => ({
    default: module.ProjectURLRulesRoute,
  })),
);
const ProjectScrubbingRoute = lazy(() =>
  import("@/features/settings/ProjectScrubbingPage").then((module) => ({
    default: module.ProjectScrubbingRoute,
  })),
);
const ProjectQuotaRoute = lazy(() =>
  import("@/features/settings/ProjectQuotaPage").then((module) => ({
    default: module.ProjectQuotaRoute,
  })),
);
const AdminOverviewPage = lazy(() =>
  import("@/features/admin/AdminOverviewPage").then((module) => ({
    default: module.AdminOverviewPage,
  })),
);
const ObjectStoragePage = lazy(() =>
  import("@/features/admin/ObjectStoragePage").then((module) => ({
    default: module.ObjectStoragePage,
  })),
);
const DataRetentionPage = lazy(() =>
  import("@/features/admin/DataRetentionPage").then((module) => ({
    default: module.DataRetentionPage,
  })),
);
const AuditPage = lazy(() =>
  import("@/features/admin/AuditPage").then((module) => ({ default: module.AuditPage })),
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
      await context.queryClient.fetchQuery(sessionQueryOptions());
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
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    expired: search.expired === true || search.expired === "1" ? true : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const status = await getSetupStatus();
    if (!status.initialized) throw redirect({ to: "/setup" });
    try {
      await context.queryClient.fetchQuery(sessionQueryOptions());
      throw redirect({ href: safeReturnTo(search.returnTo) });
    } catch (error) {
      if (error instanceof HTTPError && error.status === 401) return;
      throw error;
    }
  },
  component: LoginRoutePage,
});

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(sessionQueryOptions());
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
  component: UsagePage,
});

const projectUsageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/usage",
  component: UsagePage,
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
const channelsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/channels",
  component: ChannelsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings",
  component: MembersPage,
});

const accountRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/account",
  component: AccountPage,
});

const adminRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin",
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (!user.instanceRole) throw redirect({ to: "/projects" });
  },
  component: AdminOverviewPage,
});

const adminObjectStorageRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin/object-storage",
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (!user.instanceRole) throw redirect({ to: "/projects" });
  },
  component: ObjectStoragePage,
});

const adminDataRetentionRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin/data-retention",
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (!user.instanceRole) throw redirect({ to: "/projects" });
  },
  component: DataRetentionPage,
});

const adminAuditRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admin/audit",
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (!user.instanceRole) throw redirect({ to: "/projects" });
  },
  component: AuditPage,
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings",
  component: ProjectSettingsRoute,
});

const projectKeysRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/keys",
  component: ProjectKeysRoute,
});

const projectFiltersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/filters",
  component: ProjectFiltersRoute,
});

const projectURLRulesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/url-rules",
  component: ProjectURLRulesRoute,
});

const projectScrubbingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/scrubbing",
  component: ProjectScrubbingRoute,
});

const projectQuotaRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/quota",
  component: ProjectQuotaRoute,
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
      const DevDataPage = lazy(() =>
        import("@/features/devdata/DevDataPage").then((module) => ({
          default: module.DevDataPage,
        })),
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
    projectUsageRoute,
    alertsRoute,
    projectAlertsRoute,
    channelsRoute,
    settingsRoute,
    accountRoute,
    adminRoute,
    adminObjectStorageRoute,
    adminDataRetentionRoute,
    adminAuditRoute,
    projectSettingsRoute,
    projectKeysRoute,
    projectFiltersRoute,
    projectURLRulesRoute,
    projectScrubbingRoute,
    projectQuotaRoute,
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
