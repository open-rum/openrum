import {
  ArrowDownWideNarrowIcon,
  BugIcon,
  CircleUserRoundIcon,
  FingerprintIcon,
  Globe2Icon,
  MonitorSmartphoneIcon,
  PackageIcon,
  RouteIcon,
  TextSearchIcon,
} from "lucide-react";
import {
  FilterSearchComposer,
  type FilterSearchField,
  type FilterSearchToken,
} from "@/components/filters/FilterSearchComposer";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import type { IssueFilters, IssueOverviewResponse, IssuesResponse } from "@/lib/api/issues";

type IssueFilterPatch = Partial<Omit<IssueFilters, "projectId">>;

const sortLabels: Record<IssueFilters["sort"], string> = {
  events: "事件数排序",
  users: "影响用户排序",
  last_seen: "最近发生排序",
};

export function IssueFilterComposer({
  filters,
  facets,
  errorTypes,
  onChange,
}: {
  filters: IssueFilters;
  facets?: IssuesResponse["facets"];
  errorTypes?: IssueOverviewResponse["errorTypes"];
  onChange: (patch: IssueFilterPatch) => void;
}) {
  return (
    <FilterSearchComposer
      ariaLabel="搜索错误或添加筛选条件"
      placeholder="搜索错误标题或添加筛选条件…"
      fields={issueFields(facets, errorTypes)}
      tokens={issueTokens(filters)}
      shortcuts={[
        { label: "最近发生", onSelect: () => onChange({ sort: "last_seen" }) },
        { label: "影响用户", onSelect: () => onChange({ sort: "users" }) },
      ]}
      onSearch={(title) => onChange({ title })}
      onSelect={(key, value) => {
        const selected = String(value);
        if (key === "title") onChange({ title: selected });
        if (key === "errorType") onChange({ errorType: selected });
        if (key === "fingerprint") onChange({ fingerprint: selected });
        if (key === "userId") onChange({ userId: selected });
        if (key === "release") onChange({ release: selected });
        if (key === "browser") onChange({ browser: selected });
        if (key === "deviceType") onChange({ deviceType: selected });
        if (key === "country") onChange({ country: selected });
        if (key === "route") onChange({ route: selected });
        if (key === "sort") onChange({ sort: selected as IssueFilters["sort"] });
      }}
      onRemove={(key) => {
        if (key === "title") onChange({ title: undefined });
        if (key === "errorType") onChange({ errorType: undefined });
        if (key === "fingerprint") onChange({ fingerprint: undefined });
        if (key === "userId") onChange({ userId: undefined });
        if (key === "release") onChange({ release: undefined });
        if (key === "browser") onChange({ browser: undefined });
        if (key === "deviceType") onChange({ deviceType: undefined });
        if (key === "country") onChange({ country: undefined });
        if (key === "route") onChange({ route: undefined });
        if (key === "sort") onChange({ sort: "events" });
      }}
    />
  );
}

function issueFields(
  facets?: IssuesResponse["facets"],
  errorTypes?: IssueOverviewResponse["errorTypes"],
): FilterSearchField[] {
  const facetOptions = (
    source: Array<{ value: string; events: number; users: number }> | undefined,
    label: (value: string) => string = (value) => value,
  ) =>
    (source ?? [])
      .filter((option) => option.value)
      .map((option) => ({
        value: option.value,
        label: label(option.value),
        count: option.events,
        countLabel: "个错误事件",
      }));
  return [
    {
      key: "title",
      label: "错误标题",
      hint: "模糊匹配归并后的错误消息",
      aliases: ["title", "message", "error.message", "错误消息"],
      icon: TextSearchIcon,
      options: [],
    },
    {
      key: "errorType",
      label: "错误类型",
      hint: "TypeError、RangeError 等异常类型",
      aliases: ["type", "error.type", "error.name", "exception"],
      icon: BugIcon,
      options: (errorTypes ?? []).map((option) => ({
        value: option.value,
        label: option.value,
        count: option.events,
        countLabel: "个错误事件",
      })),
    },
    {
      key: "fingerprint",
      label: "Fingerprint",
      hint: "精确定位一个错误问题",
      aliases: ["issue", "fingerprint", "指纹"],
      icon: FingerprintIcon,
      options: [],
    },
    {
      key: "userId",
      label: "用户 ID",
      hint: "按 SDK 设置的 user.id 查找，受原始事件保留期限制",
      aliases: ["user", "user.id", "userid", "用户"],
      icon: CircleUserRoundIcon,
      options: [],
    },
    {
      key: "release",
      label: "版本",
      hint: "按 Release 定位错误回归",
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
      options: facetOptions(facets?.deviceTypes, deviceLabel),
    },
    {
      key: "country",
      label: "国家 / 地区",
      hint: "按错误发生地筛选",
      icon: Globe2Icon,
      options: facetOptions(facets?.countries, countryLabel),
    },
    {
      key: "route",
      label: "页面 Route",
      hint: "精确匹配 SDK 上报的页面路由",
      icon: RouteIcon,
      options: [],
    },
    {
      key: "sort",
      label: "排序",
      hint: "按错误量、影响用户或最近发生时间排序",
      icon: ArrowDownWideNarrowIcon,
      allowCustom: false,
      options: (Object.keys(sortLabels) as IssueFilters["sort"][]).map((value) => ({
        value,
        label: sortLabels[value],
      })),
    },
  ];
}

function issueTokens(filters: IssueFilters): FilterSearchToken[] {
  const tokens: FilterSearchToken[] = [];
  if (filters.title) tokens.push({ key: "title", label: `错误标题：${filters.title}` });
  if (filters.errorType) tokens.push({ key: "errorType", label: `错误类型：${filters.errorType}` });
  if (filters.fingerprint)
    tokens.push({ key: "fingerprint", label: `Fingerprint：${filters.fingerprint}` });
  if (filters.userId) tokens.push({ key: "userId", label: `用户 ID：${filters.userId}` });
  if (filters.release) tokens.push({ key: "release", label: `版本：${filters.release}` });
  if (filters.browser) tokens.push({ key: "browser", label: `浏览器：${filters.browser}` });
  if (filters.deviceType)
    tokens.push({ key: "deviceType", label: `设备：${deviceLabel(filters.deviceType)}` });
  if (filters.country)
    tokens.push({ key: "country", label: `国家：${countryLabel(filters.country)}` });
  if (filters.route) tokens.push({ key: "route", label: `Route：${filters.route}` });
  if (filters.sort !== "events")
    tokens.push({ key: "sort", label: `排序：${sortLabels[filters.sort]}` });
  return tokens;
}
