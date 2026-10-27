import {
  BracesIcon,
  CircleUserRoundIcon,
  Clock3Icon,
  Globe2Icon,
  HashIcon,
  MonitorSmartphoneIcon,
  MousePointerClickIcon,
  PackageIcon,
  RouteIcon,
  TagIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  SearchQueryInput,
  type SearchQueryError,
  type SearchQueryField,
} from "@/components/filters/SearchQueryInput";
import type { SessionFilters, SessionsResponse } from "@/lib/api/sessions";
import { useSearchSuggest } from "@/lib/search/useSearchSuggest";

/** The Sessions search: event conditions match when any event of the session does. */
export function SessionFilterComposer({
  filters,
  facets,
  sessions,
  error,
  onChange,
}: {
  filters: SessionFilters;
  facets?: SessionsResponse["facets"];
  sessions?: SessionsResponse["sessions"];
  /** Why the server refused the search, if it did. */
  error?: SearchQueryError;
  onChange: (patch: Partial<SessionFilters>) => void;
}) {
  const suggest = useSearchSuggest({
    projectId: filters.projectId,
    dataset: "sessions",
    from: filters.from,
    to: filters.to,
    environment: filters.environment,
  });
  return (
    <SearchQueryInput
      ariaLabel="搜索会话"
      placeholder="搜索会话、用户、页面，或输入条件，例如 route:/checkout AND errors:>0"
      value={filters.q ?? ""}
      onSubmit={(q) => onChange({ q, page: 1 })}
      fields={sessionFields(facets, sessions)}
      attributes
      suggest={suggest}
      recentKey="sessions"
      freeTextLabel="会话、用户、页面、错误"
      error={error}
      shortcuts={[
        { label: "有错误", term: "errors:>0" },
        { label: "API 失败", term: "api_failures:>0" },
        { label: "慢请求 ≥ 1s", term: "slowest_api:>=1s" },
        { label: "体验较差", term: "poor_vitals:>0" },
        { label: "移动端", term: "device:mobile" },
      ]}
    />
  );
}

function sessionFields(
  facets?: SessionsResponse["facets"],
  sessions?: SessionsResponse["sessions"],
): SearchQueryField[] {
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
      key: "route",
      type: "text",
      label: "页面与旅程",
      hint: "会话经过的 Route 或页面 URL",
      aliases: ["page"],
      icon: RouteIcon,
      options: [...routes].map((value) => ({ value: value!, label: value! })),
    },
    {
      key: "user.id",
      type: "text",
      label: "用户 ID",
      hint: "SDK 设置的 user.id",
      aliases: ["userId", "user", "用户"],
      icon: CircleUserRoundIcon,
    },
    {
      key: "anonymous_user_id",
      type: "text",
      label: "匿名访客 ID",
      hint: "SDK 生成的匿名访客标识",
      aliases: ["visitor", "访客"],
      icon: CircleUserRoundIcon,
    },
    {
      key: "session_id",
      type: "uuid",
      label: "Session ID",
      hint: "完整的会话 ID",
      icon: HashIcon,
    },
    {
      key: "event",
      type: "text",
      label: "自定义事件",
      hint: "会话中上报过的自定义事件名称",
      aliases: ["custom", "事件名"],
      icon: MousePointerClickIcon,
    },
    {
      key: "error",
      type: "text",
      label: "错误消息",
      hint: "会话中出现过的错误消息",
      icon: TriangleAlertIcon,
    },
    {
      key: "release",
      type: "text",
      label: "版本",
      hint: "按 Release 定位回归",
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
      options: facetOptions(facets?.deviceTypes),
    },
    {
      key: "country",
      type: "enum",
      label: "国家 / 地区",
      hint: "两位国家代码，例如 CN、US",
      icon: Globe2Icon,
      options: facetOptions(facets?.countries),
    },
    {
      key: "duration",
      type: "duration",
      label: "会话时长",
      hint: "例如 >2m、<30s",
      aliases: ["时长"],
      icon: Clock3Icon,
    },
    {
      key: "events",
      type: "number",
      label: "事件数量",
      hint: "会话内的事件总数",
      icon: BracesIcon,
    },
    {
      key: "errors",
      type: "number",
      label: "错误数",
      hint: "会话内的错误事件数",
      icon: TriangleAlertIcon,
    },
    {
      key: "api_failures",
      type: "number",
      label: "API 失败数",
      hint: "失败或状态码 ≥ 400 的请求数",
      icon: TriangleAlertIcon,
    },
    {
      key: "slowest_api",
      type: "duration",
      label: "最慢请求",
      hint: "会话内最慢一次 API 请求的耗时",
      icon: Clock3Icon,
    },
    {
      key: "poor_vitals",
      type: "number",
      label: "体验较差次数",
      hint: "评级为 poor 的 Web Vitals 次数",
      icon: TriangleAlertIcon,
    },
    {
      key: "attributes.",
      type: "text",
      label: "自定义属性",
      hint: "写成 attributes.名称:值",
      aliases: ["property", "属性"],
      icon: TagIcon,
    },
  ];
}
