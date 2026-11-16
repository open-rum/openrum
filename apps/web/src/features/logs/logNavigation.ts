import type { LogEntry } from "@/lib/api/logs";

export function logDetailKey(projectId: string, eventId: string, timestamp: string) {
  return ["log-detail", projectId, eventId, timestamp] as const;
}

export function logDetailLink(href: string, entry: LogEntry) {
  const url = new URL(href);
  url.searchParams.delete("timePreset");
  url.searchParams.delete("cursor");
  url.searchParams.set("log", entry.eventId);
  url.searchParams.set("logAt", entry.timestamp);
  return url.toString();
}

export function logBucketRange(bucket: string, intervalSeconds: number, from: string, to: string) {
  const start = Math.max(Date.parse(bucket), Date.parse(from));
  const end = Math.min(Date.parse(bucket) + intervalSeconds * 1000, Date.parse(to));
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
    : null;
}

export function logTime(timestamp: string, milliseconds = false) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(milliseconds ? { fractionalSecondDigits: 3 as const } : {}),
    hour12: false,
  });
}
