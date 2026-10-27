import {
  BugIcon,
  CircleUserRoundIcon,
  FileCode2Icon,
  FingerprintIcon,
  Globe2Icon,
  HashIcon,
  LaptopIcon,
  MonitorSmartphoneIcon,
  PackageIcon,
  RouteIcon,
  ScrollTextIcon,
  TagIcon,
} from "lucide-react";
import {
  SearchQueryInput,
  type SearchQueryError,
  type SearchQueryField,
} from "@/components/filters/SearchQueryInput";
import { logLevels, type LogEntry, type LogFilters } from "@/lib/api/logs";
import { useSearchSuggest } from "@/lib/search/useSearchSuggest";

/** The Logs search: the whole query is `q`, in the shared search language. */
export function LogFilterComposer({
  filters,
  items,
  error,
  onChange,
}: {
  filters: LogFilters;
  items?: LogEntry[];
  /** Why the server refused the search, if it did. */
  error?: SearchQueryError;
  onChange: (patch: Partial<LogFilters>) => void;
}) {
  const suggest = useSearchSuggest({
    projectId: filters.projectId,
    dataset: "logs",
    from: new Date(filters.from),
    to: new Date(filters.to),
    environment: filters.environment,
  });
  return (
    <SearchQueryInput
      ariaLabel="搜索日志"
      placeholder='搜索日志正文，或输入条件，例如 level:error AND user.id:"customer-123"'
      value={filters.q ?? ""}
      onSubmit={(q) => onChange({ q })}
      fields={logFields(items)}
      attributes
      suggest={suggest}
      recentKey="logs"
      freeTextLabel="日志正文"
      error={error}
      shortcuts={[
        { label: "错误日志", term: "level:[error,fatal]" },
        { label: "警告日志", term: "level:warn" },
        { label: "有 Trace", term: "has:trace_id" },
        { label: "不含调试日志", term: "!level:[debug,trace]" },
      ]}
    />
  );
}

function logFields(items?: LogEntry[]): SearchQueryField[] {
  const options = (key: keyof LogEntry) =>
    [...new Set(items?.map((item) => String(item[key] ?? "")).filter(Boolean))].map((value) => ({
      value,
      label: value,
    }));
  return [
    {
      key: "level",
      type: "enum",
      label: "日志级别",
      hint: "trace、debug、info、warn、error、fatal",
      aliases: ["severity"],
      icon: BugIcon,
      options: logLevels.map((level) => ({ value: level, label: level.toUpperCase() })),
    },
    {
      key: "message",
      type: "text",
      label: "日志正文",
      hint: "在正文中查找，区分大小写",
      icon: FileCode2Icon,
    },
    {
      key: "logger",
      type: "text",
      label: "Logger",
      hint: "日志记录器或模块",
      icon: ScrollTextIcon,
      options: options("logger"),
    },
    {
      key: "user.id",
      type: "text",
      label: "用户 ID",
      hint: "SDK 显式设置的用户标识",
      aliases: ["userId", "user_id", "user", "用户"],
      icon: CircleUserRoundIcon,
      options: options("userId"),
    },
    {
      key: "anonymous_user_id",
      type: "text",
      label: "匿名访客 ID",
      hint: "SDK 生成的匿名访客标识",
      aliases: ["anonymousUserId", "visitor"],
      icon: CircleUserRoundIcon,
      options: options("anonymousUserId"),
    },
    {
      key: "trace_id",
      type: "text",
      label: "Trace ID",
      hint: "同一条分布式调用链",
      aliases: ["traceId"],
      icon: FingerprintIcon,
      options: options("traceId"),
    },
    {
      key: "session_id",
      type: "uuid",
      label: "Session ID",
      hint: "一次会话产生的日志",
      aliases: ["sessionId"],
      icon: HashIcon,
      options: options("sessionId"),
    },
    {
      key: "route",
      type: "text",
      label: "页面 Route",
      hint: "产生日志的页面",
      icon: RouteIcon,
      options: options("route"),
    },
    {
      key: "release",
      type: "text",
      label: "版本",
      hint: "按 Release 定位回归",
      icon: PackageIcon,
      options: options("release"),
    },
    {
      key: "browser",
      type: "enum",
      label: "浏览器",
      hint: "Chrome、Safari、Firefox 等",
      icon: LaptopIcon,
      options: options("browser"),
    },
    {
      key: "device",
      type: "enum",
      label: "设备类型",
      hint: "desktop、mobile、tablet",
      aliases: ["deviceType"],
      icon: MonitorSmartphoneIcon,
      options: options("deviceType"),
    },
    {
      key: "country",
      type: "enum",
      label: "国家 / 地区",
      hint: "两位国家代码，例如 CN、US",
      icon: Globe2Icon,
      options: options("country"),
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
