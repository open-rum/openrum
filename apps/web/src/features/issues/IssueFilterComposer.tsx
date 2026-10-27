import { useCallback } from "react";
import {
  BugIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  FingerprintIcon,
  Globe2Icon,
  MonitorSmartphoneIcon,
  PackageIcon,
  RouteIcon,
  TagIcon,
  TextSearchIcon,
} from "lucide-react";
import {
  SearchQueryInput,
  type SearchQueryError,
  type SearchQueryField,
} from "@/components/filters/SearchQueryInput";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import type { IssueFilters, IssueOverviewResponse, IssuesResponse } from "@/lib/api/issues";
import { useSearchSuggest } from "@/lib/search/useSearchSuggest";

const STATE_FIELDS = new Set(["is", "assigned"]);

/**
 * The Issues search: every condition, from title to user and the Issue's own status and
 * assignee, is one query in `q`.
 */
export function IssueFilterComposer({
  projectId,
  filters,
  facets,
  errorTypes,
  error,
  onChange,
}: {
  projectId: string;
  filters: IssueFilters;
  facets?: IssuesResponse["facets"];
  errorTypes?: IssueOverviewResponse["errorTypes"];
  /** Why the server refused the search, if it did. */
  error?: SearchQueryError;
  onChange: (patch: { q?: string }) => void;
}) {
  const serverSuggest = useSearchSuggest({
    projectId,
    dataset: "issues",
    from: filters.from,
    to: filters.to,
    environment: filters.environment,
  });
  // is: and assigned: read Issue state, which the server's value index does not hold.
  const suggest = useCallback<typeof serverSuggest>(
    async (field, contains, signal) =>
      STATE_FIELDS.has(field.key) ? [] : serverSuggest(field, contains, signal),
    [serverSuggest],
  );
  return (
    <SearchQueryInput
      ariaLabel="搜索错误问题"
      placeholder="搜索错误标题，或输入条件，例如 is:unresolved assigned:me browser:Safari"
      value={filters.q ?? ""}
      // An emptied search is kept as q= so the default is:unresolved does not come back.
      onSubmit={(q) => onChange({ q: q ?? "" })}
      fields={issueFields(facets, errorTypes)}
      attributes
      suggest={suggest}
      recentKey="issues"
      freeTextLabel="错误标题"
      error={error}
    />
  );
}

function issueFields(
  facets?: IssuesResponse["facets"],
  errorTypes?: IssueOverviewResponse["errorTypes"],
): SearchQueryField[] {
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
      key: "is",
      type: "enum",
      label: "问题状态",
      hint: "待处理（含已回归）、已解决、新问题、未分配等",
      aliases: ["status", "状态"],
      icon: CircleDotIcon,
      equalsOnly: true,
      options: [
        { value: "unresolved", label: "待处理（含已回归）" },
        { value: "regressed", label: "已回归" },
        { value: "resolved", label: "已解决" },
        { value: "ignored", label: "已忽略" },
        { value: "new", label: "新问题（首次发生在所选时间内）" },
        { value: "unassigned", label: "未分配" },
        { value: "assigned", label: "已分配" },
      ],
    },
    {
      key: "assigned",
      type: "enum",
      label: "负责人",
      hint: "assigned:me 为分配给我",
      aliases: ["assignee", "负责人", "分配"],
      icon: CircleUserRoundIcon,
      equalsOnly: true,
      options: [
        { value: "me", label: "分配给我" },
        { value: "none", label: "未分配" },
      ],
    },
    {
      key: "title",
      type: "text",
      label: "错误标题",
      hint: "归并后的错误消息",
      aliases: ["message", "error.message", "错误消息"],
      icon: TextSearchIcon,
    },
    {
      key: "error.type",
      type: "text",
      label: "错误类型",
      hint: "TypeError、RangeError 等异常类型",
      aliases: ["errorType", "type", "exception"],
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
      type: "text",
      label: "Fingerprint",
      hint: "精确定位一个错误问题",
      aliases: ["issue", "指纹"],
      icon: FingerprintIcon,
    },
    {
      key: "user.id",
      type: "text",
      label: "用户 ID",
      hint: "SDK 设置的 user.id，需读取原始事件",
      aliases: ["userId", "user", "用户"],
      icon: CircleUserRoundIcon,
    },
    {
      key: "anonymous_user_id",
      type: "text",
      label: "匿名访客 ID",
      hint: "SDK 生成的匿名访客标识，需读取原始事件",
      aliases: ["visitor", "访客"],
      icon: CircleUserRoundIcon,
    },
    {
      key: "release",
      type: "text",
      label: "版本",
      hint: "按 Release 定位错误回归",
      icon: PackageIcon,
      options: facetOptions(facets?.releases),
    },
    {
      key: "browser",
      type: "enum",
      label: "浏览器",
      hint: "Chrome、Safari、Firefox 等",
      icon: MonitorSmartphoneIcon,
      options: facetOptions(facets?.browsers),
    },
    {
      key: "device",
      type: "enum",
      label: "设备类型",
      hint: "desktop、mobile、tablet",
      aliases: ["deviceType"],
      icon: MonitorSmartphoneIcon,
      options: facetOptions(facets?.deviceTypes, deviceLabel),
    },
    {
      key: "country",
      type: "enum",
      label: "国家 / 地区",
      hint: "两位国家代码，例如 CN、US",
      icon: Globe2Icon,
      options: facetOptions(facets?.countries, countryLabel),
    },
    {
      key: "route",
      type: "text",
      label: "页面 Route",
      hint: "SDK 上报的页面路由",
      icon: RouteIcon,
    },
    {
      key: "attributes.",
      type: "text",
      label: "自定义属性",
      hint: "写成 attributes.名称:值，需读取原始事件",
      aliases: ["property", "属性"],
      icon: TagIcon,
    },
  ];
}
