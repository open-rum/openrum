import {
  BracesIcon,
  Clock3Icon,
  Globe2Icon,
  MonitorSmartphoneIcon,
  PackageIcon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  FilterSearchComposer,
  type FilterSearchField,
  type FilterSearchToken,
} from "@/components/filters/FilterSearchComposer";
import type { SessionFilters, SessionsResponse } from "@/lib/api/sessions";

export function SessionFilterComposer({
  filters,
  facets,
  sessions,
  onChange,
}: {
  filters: SessionFilters;
  facets?: SessionsResponse["facets"];
  sessions?: SessionsResponse["sessions"];
  onChange: (patch: Partial<SessionFilters>) => void;
}) {
  return (
    <FilterSearchComposer
      ariaLabel="搜索会话或添加筛选条件"
      fields={sessionFields(facets, sessions)}
      tokens={filterTokens(filters)}
      shortcuts={[
        { label: "有错误", onSelect: () => onChange({ signal: "error" }) },
        { label: "API 失败", onSelect: () => onChange({ signal: "api_failure" }) },
        { label: "体验较差", onSelect: () => onChange({ signal: "poor_vital" }) },
        { label: "移动端", onSelect: () => onChange({ deviceType: "mobile" }) },
      ]}
      onSearch={(search) => onChange({ search })}
      onSelect={(key, value) => {
        if (key === "minimumEvents" || key === "minimumDuration") {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 0) onChange({ [key]: number });
          return;
        }
        onChange({ [key]: value });
      }}
      onRemove={(key) => {
        if (key === "signal") onChange({ signal: "all" });
        else onChange({ [key]: undefined });
      }}
    />
  );
}

function sessionFields(
  facets?: SessionsResponse["facets"],
  sessions?: SessionsResponse["sessions"],
): FilterSearchField[] {
  const routes = new Set(
    sessions?.flatMap((session) => [session.entryRoute, session.exitRoute]).filter(Boolean),
  );
  const facetOptions = (source?: { value: string; sessions: number }[]) =>
    (source ?? [])
      .filter((option) => option.value)
      .map((option) => ({
        value: option.value,
        label: option.value,
        count: option.sessions,
        countLabel: "个会话",
      }));
  return [
    {
      key: "signal",
      label: "关键信号",
      hint: "错误、API 失败、慢请求、较差体验",
      icon: TriangleAlertIcon,
      options: [
        { value: "error", label: "发生错误" },
        { value: "api_failure", label: "API 失败" },
        { value: "slow_api", label: "慢请求 ≥ 1s" },
        { value: "poor_vital", label: "体验评分较差" },
      ],
    },
    {
      key: "route",
      label: "页面与旅程",
      hint: "筛选会话经过的 Route",
      icon: RouteIcon,
      options: [...routes].map((value) => ({ value: value!, label: value! })),
    },
    {
      key: "release",
      label: "版本",
      hint: "按 Release 定位回归",
      icon: PackageIcon,
      options: facetOptions(facets?.releases),
    },
    {
      key: "browser",
      label: "浏览器",
      hint: "Chrome、Safari、Firefox 等",
      icon: MonitorSmartphoneIcon,
      options: facetOptions(facets?.browsers),
    },
    {
      key: "deviceType",
      label: "设备类型",
      hint: "桌面端、移动端、平板",
      icon: MonitorSmartphoneIcon,
      options: facetOptions(facets?.deviceTypes),
    },
    {
      key: "country",
      label: "国家 / 地区",
      hint: "按访问来源国家筛选",
      icon: Globe2Icon,
      options: facetOptions(facets?.countries),
    },
    {
      key: "minimumEvents",
      label: "事件数量",
      hint: "仅显示行为较丰富的会话",
      icon: BracesIcon,
      options: [5, 10, 20, 50].map((value) => ({ value, label: `至少 ${value} 个事件` })),
    },
    {
      key: "minimumDuration",
      label: "会话时长",
      hint: "设置最短持续时间",
      icon: Clock3Icon,
      options: [30, 60, 300, 600].map((value) => ({
        value,
        label: value < 60 ? `至少 ${value} 秒` : `至少 ${value / 60} 分钟`,
      })),
    },
  ];
}

function filterTokens(filters: SessionFilters): FilterSearchToken[] {
  const tokens: FilterSearchToken[] = [];
  if (filters.search) tokens.push({ key: "search", label: `关键词：${filters.search}` });
  if (filters.signal !== "all") tokens.push({ key: "signal", label: signalLabel(filters.signal) });
  if (filters.route) tokens.push({ key: "route", label: `Route：${filters.route}` });
  if (filters.release) tokens.push({ key: "release", label: `版本：${filters.release}` });
  if (filters.browser) tokens.push({ key: "browser", label: `浏览器：${filters.browser}` });
  if (filters.deviceType) tokens.push({ key: "deviceType", label: `设备：${filters.deviceType}` });
  if (filters.country) tokens.push({ key: "country", label: `国家：${filters.country}` });
  if (filters.minimumEvents)
    tokens.push({ key: "minimumEvents", label: `事件 ≥ ${filters.minimumEvents}` });
  if (filters.minimumDuration)
    tokens.push({ key: "minimumDuration", label: `时长 ≥ ${filters.minimumDuration}s` });
  return tokens;
}

function signalLabel(signal: SessionFilters["signal"]) {
  return {
    all: "全部信号",
    error: "发生错误",
    api_failure: "API 失败",
    slow_api: "慢请求 ≥ 1s",
    poor_vital: "体验评分较差",
  }[signal];
}
