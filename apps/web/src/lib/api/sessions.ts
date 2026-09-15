import { z } from "zod";
import { requestJSON } from "./client";

const isoTime = z.iso.datetime({ offset: true });
const facetSchema = z.object({ value: z.string(), sessions: z.number().int().nonnegative() });

export const sessionSummarySchema = z.object({
  sessionId: z.uuid(),
  visitorId: z.string().optional(),
  userId: z.string().optional(),
  startedAt: isoTime,
  endedAt: isoTime,
  durationSeconds: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  pageViews: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  apiFailures: z.number().int().nonnegative(),
  customEvents: z.number().int().nonnegative(),
  environment: z.string().optional(),
  release: z.string().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  deviceType: z.string().optional(),
  country: z.string().optional(),
  entryRoute: z.string().optional(),
  exitRoute: z.string().optional(),
  slowestApiMs: z.number().nonnegative(),
  lcp: z.number().nonnegative().optional(),
  inp: z.number().nonnegative().optional(),
  cls: z.number().nonnegative().optional(),
});

export const sessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  facets: z.object({
    environments: z.array(facetSchema),
    releases: z.array(facetSchema),
    browsers: z.array(facetSchema),
    deviceTypes: z.array(facetSchema),
    countries: z.array(facetSchema),
  }),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
export type SessionSignal = "all" | "error" | "api_failure" | "slow_api" | "poor_vital";
export type SessionSort = "latest" | "duration" | "events" | "errors";
export type SessionFilters = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  release?: string;
  browser?: string;
  deviceType?: string;
  country?: string;
  route?: string;
  search?: string;
  signal: SessionSignal;
  sort: SessionSort;
  minimumEvents?: number;
  minimumDuration?: number;
  page: number;
};

export const sessionEventKindSchema = z.enum([
  "page_view",
  "navigation",
  "click",
  "custom",
  "error",
  "api",
  "log",
  "web_vital",
]);

export const sessionTimelineEventSchema = z.object({
  eventId: z.uuid(),
  timestamp: isoTime,
  receivedAt: isoTime.optional(),
  kind: sessionEventKindSchema,
  title: z.string(),
  route: z.string().optional(),
  pageId: z.uuid().optional(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  navigationType: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  errorType: z.string().optional(),
  errorMessage: z.string().optional(),
  errorMechanism: z.string().optional(),
  fingerprint: z.string().optional(),
  handled: z.boolean().optional(),
  apiMethod: z.string().optional(),
  apiUrl: z.string().optional(),
  apiStatus: z.number().int().nonnegative().optional(),
  apiFailure: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  transferSize: z.number().int().nonnegative().optional(),
  logLevel: z.string().optional(),
  logMessage: z.string().optional(),
  logger: z.string().optional(),
  metricName: z.string().optional(),
  metricValue: z.number().optional(),
  metricDelta: z.number().optional(),
  metricRating: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  sampleRate: z.number().nonnegative().optional(),
  attributes: z.record(z.string(), z.string()),
  measurements: z.record(z.string(), z.number()).optional(),
  ingestFlags: z.array(z.string()).optional(),
});

export const sessionTimelineSchema = z.object({
  projectId: z.uuid(),
  sessionId: z.uuid(),
  from: isoTime,
  to: isoTime,
  session: sessionSummarySchema,
  events: z.array(sessionTimelineEventSchema).max(100),
  nextCursor: z.string().optional(),
  truncated: z.boolean(),
  availability: z.object({
    sampled: z.boolean(),
    expiredLogs: z.boolean(),
    timelineExact: z.boolean(),
    replay: z.boolean(),
  }),
});

export type SessionEventKind = z.infer<typeof sessionEventKindSchema>;
export type SessionTimelineEvent = z.infer<typeof sessionTimelineEventSchema>;
export type SessionTimeline = z.infer<typeof sessionTimelineSchema>;

export type SessionTimelineFilters = {
  projectId: string;
  sessionId: string;
  from: Date;
  to: Date;
  cursor?: string;
  kinds?: SessionEventKind[];
  limit?: number;
};

export function getSessions(filters: SessionFilters, signal?: AbortSignal) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    signal: filters.signal === "all" ? "" : filters.signal,
    sort: filters.sort,
    page: String(filters.page),
    limit: "50",
  });
  for (const [key, value] of Object.entries({
    environment: filters.environment,
    release: filters.release,
    browser: filters.browser,
    deviceType: filters.deviceType,
    country: filters.country,
    route: filters.route,
    search: filters.search,
    minimumEvents: filters.minimumEvents,
    minimumDuration: filters.minimumDuration,
  })) {
    if (value !== undefined && value !== "" && value !== 0) parameters.set(key, String(value));
  }
  return requestJSON(
    sessionsResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/analytics/sessions?${parameters}`,
    { signal },
  );
}

export function getSessionTimelinePage(filters: SessionTimelineFilters, signal?: AbortSignal) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    limit: String(filters.limit ?? 100),
  });
  if (filters.cursor) parameters.set("cursor", filters.cursor);
  if (filters.kinds?.length) parameters.set("type", filters.kinds.join(","));
  return requestJSON(
    sessionTimelineSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/analytics/sessions/${encodeURIComponent(filters.sessionId)}?${parameters}`,
    { signal },
  );
}

export function getSessionTimeline(
  projectId: string,
  sessionId: string,
  from: Date,
  to: Date,
  signal?: AbortSignal,
) {
  return getSessionTimelinePage({ projectId, sessionId, from, to }, signal);
}

export function sessionRange(session: Pick<SessionSummary, "startedAt" | "endedAt">) {
  const from = new Date(session.startedAt);
  const endedAt = new Date(session.endedAt);
  const to = new Date(Math.min(endedAt.getTime() + 1, from.getTime() + 24 * 60 * 60 * 1000));
  return { from, to };
}

export function sessionDetailHref(
  projectId: string,
  session: Pick<SessionSummary, "sessionId" | "startedAt" | "endedAt">,
  eventId?: string,
) {
  const range = sessionRange(session);
  const parameters = new URLSearchParams({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  });
  if (eventId) parameters.set("event", eventId);
  return `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(session.sessionId)}?${parameters}`;
}

export function sessionEventHref(
  projectId: string,
  sessionId: string,
  timestamp: string,
  eventId: string,
) {
  const anchor = new Date(timestamp).getTime();
  const parameters = new URLSearchParams({
    from: new Date(anchor - 12 * 60 * 60 * 1000).toISOString(),
    to: new Date(anchor + 12 * 60 * 60 * 1000).toISOString(),
    event: eventId,
  });
  return `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}?${parameters}`;
}
