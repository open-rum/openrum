import type { ComponentType } from "react";
import {
  ActivityIcon,
  ChartColumnIcon,
  ChartNoAxesCombinedIcon,
  HashIcon,
  BugIcon,
  type LucideIcon,
} from "lucide-react";
import type { OverviewFilters } from "@/lib/filters/schema";
import { adaptStat, adaptPlot, adaptList, type AdaptedData } from "./adapters";
import {
  createWidget,
  widgetSchema,
  type Widget,
  type WidgetType,
  type WidgetView,
  type WidgetSize,
} from "./model";
import {
  StatRenderer,
  PlotRenderer,
  ListRenderer,
  type ModuleRenderProps,
} from "./ModuleRenderers";
import { ModuleFields, type ModuleFieldsProps } from "./ModuleFields";
import type { DashboardData } from "./queries";

export type ModuleDefinition = {
  type: WidgetType;
  version: 1;
  name: string;
  group: "指标" | "趋势" | "分布" | "列表";
  description: string;
  icon: LucideIcon;
  sizes: readonly WidgetSize[];
  views: readonly WidgetView[];
  schema: typeof widgetSchema;
  create: () => Widget;
  adapt: (widget: Widget, data: DashboardData, filters: OverviewFilters) => AdaptedData;
  Render: ComponentType<ModuleRenderProps>;
  Editor: ComponentType<ModuleFieldsProps>;
};

// Bundled, typed modules only. New business modules register here and implement
// the same adapter/editor/renderer contract; the dashboard shell stays generic.
export const moduleRegistry: Record<WidgetType, ModuleDefinition> = {
  stat: {
    type: "stat",
    version: 1,
    name: "指标卡",
    group: "指标",
    description: "PV、UV、稳定性、性能或事件总量",
    icon: HashIcon,
    sizes: ["compact", "half"],
    views: ["number"],
    schema: widgetSchema,
    create: () => createWidget("stat"),
    adapt: adaptStat,
    Render: StatRenderer,
    Editor: ModuleFields,
  },
  timeseries: {
    type: "timeseries",
    version: 1,
    name: "时间趋势",
    group: "趋势",
    description: "用 Area、Line 或 Bar 观察指标变化",
    icon: ChartNoAxesCombinedIcon,
    sizes: ["half", "full"],
    views: ["area", "line", "bar"],
    schema: widgetSchema,
    create: () => createWidget("timeseries"),
    adapt: adaptPlot,
    Render: PlotRenderer,
    Editor: ModuleFields,
  },
  breakdown: {
    type: "breakdown",
    version: 1,
    name: "维度分布",
    group: "分布",
    description: "国家地图，或设备、浏览器与自定义属性的 Top 10",
    icon: ChartColumnIcon,
    sizes: ["half", "full"],
    views: ["bar", "table", "map"],
    schema: widgetSchema,
    create: () => createWidget("breakdown"),
    adapt: adaptPlot,
    Render: PlotRenderer,
    Editor: ModuleFields,
  },
  "top-issues": {
    type: "top-issues",
    version: 1,
    name: "Top 问题",
    group: "列表",
    description: "查看影响用户最多的问题并进入详情",
    icon: BugIcon,
    sizes: ["half", "full"],
    views: ["table"],
    schema: widgetSchema,
    create: () => createWidget("top-issues"),
    adapt: adaptList,
    Render: ListRenderer,
    Editor: ModuleFields,
  },
  "slow-apis": {
    type: "slow-apis",
    version: 1,
    name: "慢 API",
    group: "列表",
    description: "按 P95 耗时定位慢请求",
    icon: ActivityIcon,
    sizes: ["half", "full"],
    views: ["table"],
    schema: widgetSchema,
    create: () => createWidget("slow-apis"),
    adapt: adaptList,
    Render: ListRenderer,
    Editor: ModuleFields,
  },
};
