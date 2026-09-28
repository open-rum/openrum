import type { ComponentType } from "react";
import {
  ChartColumnIcon,
  ChartNoAxesCombinedIcon,
  HashIcon,
  BugIcon,
  ListOrderedIcon,
  TableIcon,
  type LucideIcon,
} from "lucide-react";
import type { OverviewFilters } from "@/lib/filters/schema";
import { adaptStat, adaptPlot, adaptList, adaptTable, type AdaptedData } from "./adapters";
import {
  createCatalogWidget,
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
  TableRenderer,
  type ModuleRenderProps,
} from "./ModuleRenderers";
import { ModuleFields, type ModuleFieldsProps } from "./ModuleFields";
import type { DashboardData } from "./queries";

export type ModuleDefinition = {
  type: WidgetType;
  version: 1 | 2;
  name: string;
  group: "指标" | "趋势" | "分布" | "列表";
  description: string;
  icon: LucideIcon;
  sizes: readonly WidgetSize[];
  views: readonly WidgetView[];
  previewView?: WidgetView;
  schema: typeof widgetSchema;
  create: () => Widget;
  adapt: (widget: Widget, data: DashboardData, filters: OverviewFilters) => AdaptedData;
  Render: ComponentType<ModuleRenderProps>;
  Editor: ComponentType<ModuleFieldsProps>;
  /** Only offered once the metric catalog has loaded. */
  requiresCatalog?: boolean;
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
    create: () => createCatalogWidget("stat", { metrics: ["traffic.pageViews"] }, { title: "PV" }),
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
    views: ["area", "line", "bar", "stacked-area", "stacked-bar"],
    schema: widgetSchema,
    create: () =>
      createCatalogWidget(
        "timeseries",
        { metrics: ["traffic.pageViews"] },
        { title: "PV 趋势", view: "line" },
      ),
    adapt: adaptPlot,
    Render: PlotRenderer,
    Editor: ModuleFields,
  },
  breakdown: {
    type: "breakdown",
    version: 1,
    name: "维度分布",
    group: "分布",
    description: "国家、设备、浏览器或自定义属性，支持排行条、表格与圆环列表",
    icon: ChartColumnIcon,
    sizes: ["half", "full"],
    views: ["bar", "donut", "table"],
    schema: widgetSchema,
    create: () =>
      createCatalogWidget(
        "breakdown",
        { metrics: ["traffic.pageViews"], dimension: "country" },
        { title: "PV 分布", view: "bar" },
      ),
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
  "ranked-table": {
    type: "ranked-table",
    version: 2,
    name: "排行表",
    group: "列表",
    description: "一个指标按分组排行，带变化和迷你趋势",
    icon: ListOrderedIcon,
    sizes: ["half", "full"],
    views: ["table"],
    schema: widgetSchema,
    create: () => createWidget("ranked-table"),
    adapt: adaptTable,
    Render: TableRenderer,
    Editor: ModuleFields,
    requiresCatalog: true,
  },
  "metric-table": {
    type: "metric-table",
    version: 2,
    name: "指标表",
    group: "列表",
    description: "多个指标按分组并排，可按任一列排序",
    icon: TableIcon,
    sizes: ["half", "full"],
    views: ["table"],
    schema: widgetSchema,
    create: () => createWidget("metric-table"),
    adapt: adaptTable,
    Render: TableRenderer,
    Editor: ModuleFields,
    requiresCatalog: true,
  },
};
