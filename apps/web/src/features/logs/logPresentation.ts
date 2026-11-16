import type { LogEntry } from "@/lib/api/logs";
import { logSearchTerm } from "@/lib/api/logs";
import { joinTerms, queryTerms } from "@/lib/search/query";
import { parseTerm } from "@/lib/search/terms";

export const logColumns = [
  { key: "source", label: "来源 / 路由" },
  { key: "logger", label: "来源" },
  { key: "route", label: "路由" },
  { key: "user.id", label: "用户 ID" },
  { key: "session_id", label: "Session ID" },
  { key: "trace_id", label: "Trace ID" },
  { key: "release", label: "版本" },
  { key: "environment", label: "环境" },
  { key: "browser", label: "浏览器" },
  { key: "device", label: "设备" },
  { key: "country", label: "国家 / 地区" },
  { key: "anonymous_user_id", label: "匿名访客 ID" },
];
const entryFields: Record<string, keyof LogEntry> = {
  logger: "logger",
  route: "route",
  "user.id": "userId",
  session_id: "sessionId",
  trace_id: "traceId",
  release: "release",
  environment: "environment",
  browser: "browser",
  device: "deviceType",
  country: "country",
  anonymous_user_id: "anonymousUserId",
};
export const defaultLogColumns = ["source"];
export const validLogAttribute = (key: string) => /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key);
export const validLogColumn = (key: string) =>
  logColumns.some((column) => column.key === key) ||
  (key.startsWith("attributes.") && validLogAttribute(key.slice(11)));
export const logColumnLabel = (key: string) =>
  logColumns.find((column) => column.key === key)?.label ??
  (key.startsWith("attributes.") ? key.slice(11) : key);
export function logColumnValue(entry: LogEntry, key: string): string {
  if (key.startsWith("attributes.")) return entry.attributes[key.slice(11)] ?? "";
  return String(entry[entryFields[key]] ?? "");
}
export function readLogColumns(storageKey: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (Array.isArray(stored))
      return [
        ...new Set(
          stored.filter((key): key is string => typeof key === "string" && validLogColumn(key)),
        ),
      ];
  } catch {
    /* Blocked storage only loses the preference. */
  }
  return defaultLogColumns;
}

/** Replace an opposite exact condition rather than creating an impossible AND. */
export function withLogFilter(query: string, key: string, value: string, exclude = false) {
  const rest = queryTerms(query).filter((text) => {
    const term = parseTerm(text);
    return !(term?.field === key && term.operator === "eq" && term.values[0] === value);
  });
  return joinTerms([...rest, `${exclude ? "!" : ""}${logSearchTerm(key, value)}`]);
}

/** Case-sensitive matches, restricted to positive message conditions in the shared grammar. */
export function messageParts(message: string, query: string) {
  const ranges: Array<[number, number]> = [];
  for (const text of queryTerms(query)) {
    const term = parseTerm(text);
    if (
      !term ||
      term.negated ||
      (term.field && term.field !== "message") ||
      !["eq", "contains", "prefix", "suffix", "in"].includes(term.operator)
    )
      continue;
    for (const value of term.values) {
      if (!value) continue;
      let at = message.indexOf(value);
      while (at >= 0) {
        if (
          (term.operator !== "prefix" || at === 0) &&
          (term.operator !== "suffix" || at + value.length === message.length) &&
          (term.operator !== "in" || message === value)
        )
          ranges.push([at, at + value.length]);
        at = message.indexOf(value, at + value.length);
      }
    }
  }
  const merged: Array<[number, number]> = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  let end = 0;
  for (const [start, next] of merged) {
    if (start > end) parts.push({ text: message.slice(end, start), match: false });
    parts.push({ text: message.slice(start, next), match: true });
    end = next;
  }
  if (end < message.length) parts.push({ text: message.slice(end), match: false });
  return parts;
}
