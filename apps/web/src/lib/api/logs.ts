import { z } from "zod";
import { requestJSON } from "./client";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof logLevels)[number];
const count = z.number().int().nonnegative();
export const logPageSchema = z.object({
  items: z
    .array(
      z.object({
        eventId: z.uuid(),
        timestamp: z.iso.datetime({ offset: true }),
        level: z.enum(logLevels),
        message: z.string(),
        logger: z.string(),
        environment: z.string(),
        release: z.string(),
        route: z.string(),
        pageUrl: z.string(),
        browser: z.string(),
        deviceType: z.string(),
        country: z.string(),
        sessionId: z.uuid(),
        userId: z.string().default(""),
        anonymousUserId: z.string().default(""),
        traceId: z.string(),
        spanId: z.string(),
        attributes: z.record(z.string(), z.string()),
        sampleRate: z.number().positive().max(1),
      }),
    )
    .max(100),
  trend: z.array(
    z.object({
      bucket: z.iso.datetime({ offset: true }),
      trace: count,
      debug: count,
      info: count,
      warn: count,
      error: count,
      fatal: count,
    }),
  ),
  total: count,
  nextCursor: z.string(),
  intervalSeconds: z.number().int().positive(),
});
export type LogPage = z.infer<typeof logPageSchema>;
export type LogEntry = LogPage["items"][number];
export type LogFilters = {
  projectId: string;
  from: string;
  to: string;
  environment?: string;
  q?: string;
  level?: string;
  cursor?: string;
  country?: string;
  deviceType?: string;
  route?: string;
  browser?: string;
  release?: string;
};
export const logFilterKeys = [
  "q",
  "level",
  "cursor",
  "country",
  "deviceType",
  "route",
  "browser",
  "release",
] as const;

export function getLogs(filters: LogFilters, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ from: filters.from, to: filters.to });
  for (const key of ["environment", ...logFilterKeys] as const) {
    if (filters[key]) parameters.set(key, filters[key]);
  }
  return requestJSON(
    logPageSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/logs?${parameters}`,
    { signal },
  );
}

export function logSearchTerm(key: string, value: string) {
  return `${key}:${JSON.stringify(value)}`;
}

/** Keep gaps visible instead of stretching sparse buckets across the chart. */
export function completeLogTrend(data: LogPage, from: string, to: string) {
  const step = data.intervalSeconds * 1000;
  const start = Math.floor(Date.parse(from) / step) * step;
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const buckets = new Map(data.trend.map((point) => [Date.parse(point.bucket), point]));
  return Array.from({ length: Math.min(200, Math.ceil((end - start) / step)) }, (_, i) => {
    const timestamp = start + i * step;
    return (
      buckets.get(timestamp) ?? {
        bucket: new Date(timestamp).toISOString(),
        trace: 0,
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        fatal: 0,
      }
    );
  });
}
