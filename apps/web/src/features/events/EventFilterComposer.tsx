import { ActivityIcon, BracesIcon, ChartNoAxesColumnIcon } from "lucide-react";
import {
  FilterSearchComposer,
  type FilterSearchField,
  type FilterSearchToken,
} from "@/components/filters/FilterSearchComposer";
import type {
  BehaviorAnalyticsResponse,
  BehaviorDimension,
  BehaviorFilters,
  BehaviorKind,
} from "@/lib/api/analytics";
import { eventLabel } from "@/features/analytics/labels";

export function EventFilterComposer({
  filters,
  data,
  onChange,
}: {
  filters: BehaviorFilters;
  data?: BehaviorAnalyticsResponse;
  onChange: (patch: Partial<BehaviorFilters>) => void;
}) {
  return (
    <FilterSearchComposer
      ariaLabel="搜索事件或添加筛选条件"
      fields={eventFields(data)}
      tokens={eventTokens(filters)}
      shortcuts={[
        {
          label: "页面访问",
          onSelect: () => onChange({ eventKind: "page_view", eventName: undefined }),
        },
        { label: "点击", onSelect: () => onChange({ eventKind: "click", eventName: undefined }) },
        {
          label: "自定义事件",
          onSelect: () => onChange({ eventKind: "custom", eventName: undefined }),
        },
      ]}
      onSelect={(key, value) => {
        const selected = String(value);
        if (key === "event") {
          const separator = selected.indexOf(":");
          const eventKind = selected.slice(0, separator) as BehaviorKind;
          const eventName = selected.slice(separator + 1);
          onChange({ eventKind, eventName: eventName === "*" ? undefined : eventName });
          return;
        }
        if (key === "dimension") {
          onChange({ dimension: selected as BehaviorDimension });
          return;
        }
        if (key === "measurement") onChange({ measurement: selected });
      }}
      onRemove={(key) => {
        if (key === "event") onChange({ eventKind: undefined, eventName: undefined });
        if (key === "dimension") onChange({ dimension: "country" });
        if (key === "measurement") onChange({ measurement: undefined });
      }}
    />
  );
}

function eventFields(data?: BehaviorAnalyticsResponse): FilterSearchField[] {
  return [
    {
      key: "event",
      label: "事件",
      hint: "按事件类型或具体事件名称筛选",
      icon: ActivityIcon,
      allowCustom: false,
      options: [
        { value: "page_view:*", label: "全部页面访问" },
        { value: "navigation:*", label: "全部页面导航" },
        { value: "click:*", label: "全部点击" },
        { value: "custom:*", label: "全部自定义事件" },
        ...(data?.catalog.map((event) => ({
          value: `${event.kind}:${event.name}`,
          label: eventLabel(event.kind, event.name),
          count: event.metric.events,
          countLabel: "个事件",
        })) ?? []),
      ],
    },
    {
      key: "dimension",
      label: "分群维度",
      hint: "按国家、设备、浏览器、来源或自定义属性拆分",
      icon: BracesIcon,
      allowCustom: false,
      options: [
        { value: "country", label: "国家" },
        { value: "device", label: "设备" },
        { value: "browser", label: "浏览器" },
        { value: "source", label: "来源" },
        ...(data?.properties.map((property) => ({
          value: `property:${property.name}`,
          label: `属性 · ${property.name}`,
          count: property.events,
          countLabel: "个事件",
        })) ?? []),
      ],
    },
    {
      key: "measurement",
      label: "测量值",
      hint: "选择自定义数值指标进行分析",
      icon: ChartNoAxesColumnIcon,
      allowCustom: false,
      options:
        data?.measurements.map((measurement) => ({
          value: measurement.name,
          label: measurement.name,
          count: measurement.samples,
          countLabel: "个样本",
        })) ?? [],
    },
  ];
}

function eventTokens(filters: BehaviorFilters): FilterSearchToken[] {
  const tokens: FilterSearchToken[] = [];
  if (filters.eventKind) {
    tokens.push({
      key: "event",
      label: filters.eventName
        ? `事件：${eventLabel(filters.eventKind, filters.eventName)}`
        : `事件：${eventKindLabel(filters.eventKind)}`,
    });
  }
  if (filters.dimension !== "country")
    tokens.push({ key: "dimension", label: `分群：${dimensionLabel(filters.dimension)}` });
  if (filters.measurement)
    tokens.push({ key: "measurement", label: `测量值：${filters.measurement}` });
  return tokens;
}

function eventKindLabel(kind: BehaviorKind) {
  return {
    page_view: "全部页面访问",
    navigation: "全部页面导航",
    click: "全部点击",
    custom: "全部自定义事件",
  }[kind];
}

function dimensionLabel(dimension: BehaviorDimension) {
  if (dimension.startsWith("property:")) return `属性 · ${dimension.slice(9)}`;
  if (dimension === "device") return "设备";
  if (dimension === "browser") return "浏览器";
  if (dimension === "source") return "来源";
  return "国家";
}
