import { Bell, Gauge, PlayCircle, Pulse, WarningCircle } from "@phosphor-icons/react";
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
import { OverviewPage } from "@/features/overview/OverviewPage";
import { ProjectCreatePage } from "@/features/projects/ProjectCreatePage";
import { MembersPage } from "@/features/settings/MembersPage";
import { ProjectKeysRoute } from "@/features/settings/ProjectKeys";
import { App } from "./App";
import { PlannedPage } from "./PlannedPage";
import { queryClient } from "./queryClient";

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
  component: OverviewPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/onboarding",
  component: ProjectCreatePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings",
  component: MembersPage,
});

const projectKeysRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId/settings/keys",
  component: ProjectKeysRoute,
});

const plannedRoutes = [
  {
    path: "/issues",
    title: "异常栈",
    description: "错误聚合、事件上下文、调用栈还原和 Source Map 定位将在此呈现。",
    icon: WarningCircle,
  },
  {
    path: "/replays",
    title: "回放列表",
    description: "按用户、页面、异常和自定义属性筛选并重放真实会话。",
    icon: PlayCircle,
  },
  {
    path: "/performance",
    title: "性能追踪",
    description: "查看 Core Web Vitals、页面加载阶段、资源瀑布和慢交互。",
    icon: Gauge,
  },
  {
    path: "/apis",
    title: "API 监控",
    description: "分析请求量、成功率、延迟分位、错误响应和关联会话。",
    icon: Pulse,
  },
  {
    path: "/alerts",
    title: "告警配置",
    description: "配置基于错误、性能、流量和自定义指标的告警规则。",
    icon: Bell,
  },
] as const;

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
    onboardingRoute,
    settingsRoute,
    projectKeysRoute,
    ...protectedChildren,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
