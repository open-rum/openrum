import { z } from "zod";
import { requestJSON } from "./client";
import { continuousRows, TIME_SERIES_MAX_POINTS } from "@/lib/charts/timeSeries";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof logLevels)[number];
const count = z.number().int().nonnegative();
export const logPageSchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
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
  previousCursor: z.string().optional(),
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
  limit?: number;
  anchor?: string;
  anchorAt?: string;
  direction?: "before" | "after";
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
  "anchor",
  "anchorAt",
  "direction",
  "country",
  "deviceType",
  "route",
  "browser",
  "release",
] as const;

export function getLogs(filters: LogFilters, signal?: AbortSignal) {
  const parameters = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    maxPoints: String(TIME_SERIES_MAX_POINTS),
  });
  if (filters.limit !== undefined) parameters.set("limit", String(filters.limit));
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
  if (
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(to) <= Date.parse(from)
  )
    return [];
  return continuousRows(
    data.trend.map((point) => ({ ...point, label: point.bucket })),
    data.from ?? from,
    data.to ?? to,
    data.intervalSeconds,
    [...logLevels],
  );
}

export async function getLog(
  projectId: string,
  eventId: string,
  timestamp: string,
  signal?: AbortSignal,
) {
  const at = Date.parse(timestamp);
  if (!z.uuid().safeParse(eventId).success || !Number.isFinite(at))
    throw new Error("日志链接无效。");
  const data = await getLogs(
    {
      projectId,
      // A narrow window still tolerates database parameter timestamp precision;
      // the typed event_id condition selects the exact log within that window.
      from: new Date(at - 60_000).toISOString(),
      to: new Date(at + 60_000).toISOString(),
      q: logSearchTerm("event_id", eventId),
    },
    signal,
  );
  return data.items.find((entry) => entry.eventId === eventId) ?? null;
}
