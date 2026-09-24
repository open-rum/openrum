import {
  BugIcon,
  CircleUserRoundIcon,
  FileCode2Icon,
  FingerprintIcon,
  Globe2Icon,
  HashIcon,
  LaptopIcon,
  PackageIcon,
  RouteIcon,
  ScrollTextIcon,
  TagsIcon,
} from "lucide-react";
import {
  FilterSearchComposer,
  type FilterSearchField,
  type FilterSearchToken,
} from "@/components/filters/FilterSearchComposer";
import { logLevels, logSearchTerm, type LogEntry, type LogFilters } from "@/lib/api/logs";
import { splitTerms } from "./logFilterQuery";

export function LogFilterComposer({
  filters,
  items,
  onChange,
}: {
  filters: LogFilters;
  items?: LogEntry[];
  onChange: (patch: Partial<LogFilters>) => void;
}) {
  const terms = splitTerms(filters.q ?? "");
  const appendQuery = (term: string) =>
    onChange({ q: [...terms, term].filter(Boolean).join(" ") || undefined });
  return (
    <FilterSearchComposer
      ariaLabel="搜索日志或添加筛选条件"
      placeholder="搜索消息、用户或添加筛选条件…"
      fields={logFields(items)}
      tokens={logTokens(filters, terms)}
      shortcuts={[
        { label: "错误日志", onSelect: () => onChange({ level: "error" }) },
        { label: "警告日志", onSelect: () => onChange({ level: "warn" }) },
        { label: "有 Trace", onSelect: () => appendQuery("trace_id:*") },
      ]}
      onSearch={appendQuery}
      onSelect={(key, value) => {
        if (key === "level") {
          onChange({ level: String(value) });
          return;
        }
        if (key === "raw" || key === "message") appendQuery(String(value));
        else appendQuery(logSearchTerm(key, String(value)));
      }}
      onRemove={(key) => {
        if (key === "level") {
          onChange({ level: undefined });
          return;
        }
        if (!key.startsWith("q:")) return;
        const index = Number(key.slice(2));
        onChange({ q: terms.filter((_, termIndex) => termIndex !== index).join(" ") || undefined });
      }}
    />
  );
}

function logFields(items?: LogEntry[]): FilterSearchField[] {
  const options = (key: keyof LogEntry) =>
    [...new Set(items?.map((item) => String(item[key] ?? "")).filter(Boolean))].map((value) => ({
      value,
      label: value,
    }));
  return [
    {
      key: "level",
      label: "日志级别",
      hint: "TRACE、DEBUG、INFO、WARN、ERROR、FATAL",
      icon: BugIcon,
      allowCustom: false,
      options: logLevels.map((level) => ({ value: level, label: level.toUpperCase() })),
    },
    {
      key: "logger",
      label: "Logger",
      hint: "按日志记录器或模块筛选",
      icon: ScrollTextIcon,
      options: options("logger"),
    },
    {
      key: "route",
      label: "页面 Route",
      hint: "筛选特定页面产生的日志",
      icon: RouteIcon,
      options: options("route"),
    },
    {
      key: "release",
      label: "版本",
      hint: "按 Release 定位回归",
      icon: PackageIcon,
      options: options("release"),
    },
    {
      key: "browser",
      label: "浏览器",
      hint: "Chrome、Safari、Firefox 等",
      icon: LaptopIcon,
      options: options("browser"),
    },
    {
      key: "country",
      label: "国家 / 地区",
      hint: "按访问来源国家筛选",
      icon: Globe2Icon,
      options: options("country"),
    },
    {
      key: "trace_id",
      label: "Trace ID",
      hint: "定位同一条分布式调用链",
      icon: FingerprintIcon,
      options: options("traceId"),
    },
    {
      key: "session_id",
      label: "Session ID",
      hint: "查看一次会话产生的日志",
      icon: HashIcon,
      options: options("sessionId"),
    },
    {
      key: "user.id",
      label: "用户 ID",
      hint: "按 SDK 显式设置的用户标识筛选",
      aliases: ["user", "user.id", "userid", "用户"],
      icon: CircleUserRoundIcon,
      options: options("userId"),
    },
    {
      key: "anonymous_user_id",
      label: "匿名访客 ID",
      hint: "按匿名访客标识筛选",
      icon: CircleUserRoundIcon,
      options: options("anonymousUserId"),
    },
    {
      key: "raw",
      label: "属性表达式",
      hint: '输入自定义属性，例如 checkout.step:"payment"',
      icon: TagsIcon,
      options: [],
    },
    {
      key: "message",
      label: "日志正文",
      hint: "输入要在消息正文中查找的关键词",
      icon: FileCode2Icon,
      options: [],
    },
  ];
}

function logTokens(filters: LogFilters, terms: string[]): FilterSearchToken[] {
  const tokens = terms.map((term, index) => ({ key: `q:${index}`, label: formatTerm(term) }));
  if (filters.level)
    tokens.unshift({ key: "level", label: `级别：${filters.level.toUpperCase()}` });
  return tokens;
}

function formatTerm(term: string) {
  const separator = term.indexOf(":");
  if (separator < 1) return `正文：${term}`;
  const key = term.slice(0, separator);
  const rawValue = term.slice(separator + 1);
  let value = rawValue;
  try {
    value = JSON.parse(rawValue);
  } catch {
    // Wildcards and existing unquoted terms remain readable as entered.
  }
  const label = {
    severity: "级别",
    logger: "Logger",
    route: "Route",
    release: "版本",
    browser: "浏览器",
    country: "国家",
    trace_id: "Trace ID",
    session_id: "Session ID",
    "user.id": "用户 ID",
    anonymous_user_id: "访客 ID",
    message: "正文",
  }[key];
  return `${label ?? key}：${value}`;
}
