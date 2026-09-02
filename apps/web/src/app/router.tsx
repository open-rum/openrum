import {
  Bell,
  Gauge,
  GearSix,
  PlayCircle,
  Plug,
  Pulse,
  WarningCircle,
} from "@phosphor-icons/react";
import { type QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter } from "@tanstack/react-router";
import { OverviewPage } from "../features/overview/OverviewPage";
import { App } from "./App";
import { PlannedPage } from "./PlannedPage";
import { queryClient } from "./queryClient";

type RouterContext = {
  queryClient: QueryClient;
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: App,
  notFoundComponent: () => (
    <PlannedPage
      title="页面不存在"
      description="当前地址没有对应页面，请返回数据大盘继续浏览。"
      icon={WarningCircle}
    />
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
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
  {
    path: "/settings",
    title: "设置",
    description: "管理项目、环境、成员、数据保留策略和隐私规则。",
    icon: GearSix,
  },
  {
    path: "/onboarding",
    title: "接入向导",
    description: "创建项目并获取 SDK 配置，验证首个事件与 Source Map 上传。",
    icon: Plug,
  },
] as const;

const childRoutes = plannedRoutes.map(({ path, title, description, icon }) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <PlannedPage title={title} description={description} icon={icon} />,
  }),
);

const routeTree = rootRoute.addChildren([indexRoute, ...childRoutes]);

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
