import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";
import { getSessionTimeline, sessionTimelineSchema, type SessionTimeline } from "./sessions";

export { getSessionTimeline, sessionTimelineSchema };
export type { SessionTimeline };

const isoTime = z.iso.datetime({ offset: true });
const facet = z.object({
  value: z.string(),
  events: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
});

export const issueStatusSchema = z.enum(["unresolved", "resolved", "ignored"]);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

export const issuesResponseSchema = z.object({
  issues: z.array(
    z.object({
      fingerprint: z.string(),
      fingerprintVersion: z.number().int().positive(),
      title: z.string(),
      errorType: z.string(),
      events: z.number().int().nonnegative(),
      users: z.number().int().nonnegative(),
      sessions: z.number().int().nonnegative(),
      firstSeenAt: isoTime,
      lastSeenAt: isoTime,
      status: issueStatusSchema,
      assigneeUserId: z.string().nullable(),
      resolvedInReleaseId: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().optional(),
  facets: z.object({
    environments: z.array(facet),
    releases: z.array(facet),
    browsers: z.array(facet),
    deviceTypes: z.array(facet),
    countries: z.array(facet),
  }),
});

export type IssuesResponse = z.infer<typeof issuesResponseSchema>;

const issueOverviewPointSchema = z.object({
  bucket: isoTime,
  events: z.number().int().nonnegative(),
  anonymousUsers: z.number().int().nonnegative(),
  identifiedUsers: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});

const issueDistributionItemSchema = z.object({
  value: z.string(),
  events: z.number().int().nonnegative(),
});

export const issueOverviewResponseSchema = z.object({
  // Optional for rolling upgrades; old servers must not receive invented labels.
  from: isoTime.optional(),
  to: isoTime.optional(),
  intervalSeconds: z.number().int().positive().optional(),
  trend: z.array(issueOverviewPointSchema),
  errorTypes: z.array(issueDistributionItemSchema),
  pages: z.array(issueDistributionItemSchema),
  countries: z.array(issueDistributionItemSchema),
});

export type IssueOverviewResponse = z.infer<typeof issueOverviewResponseSchema>;

const issueSchema = issuesResponseSchema.shape.issues.element;
const issueFacetsSchema = issuesResponseSchema.shape.facets;
const trendPointSchema = z.object({
  bucket: isoTime,
  events: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
});

export const issueDetailResponseSchema = z.object({
  from: isoTime.optional(),
  to: isoTime.optional(),
  intervalSeconds: z.number().int().positive().optional(),
  issue: issueSchema,
  trend: z.array(trendPointSchema),
  facets: issueFacetsSchema,
});

const originalPositionSchema = z.object({
  source: z.string(),
  function: z.string().optional(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  sourceContent: z.string().optional(),
});

const mappedStackSchema = z.object({
  raw: z.string(),
  status: z.enum(["mapped", "partial", "failed"]),
  failure: z.string().optional(),
  frames: z.array(
    z.object({
      function: z.string().optional(),
      url: z.string(),
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
      original: originalPositionSchema.optional(),
      failure: z.string().optional(),
    }),
  ),
});

export const eventDetailSchema = z.object({
  projectId: z.string(),
  eventId: z.string(),
  timestamp: isoTime,
  receivedAt: isoTime,
  environment: z.string(),
  release: z.string().optional(),
  dist: z.string().optional(),
  sessionId: z.string(),
  visitorId: z.string().optional(),
  pageId: z.string(),
  pageUrl: z.string(),
  route: z.string().optional(),
  browser: z.string().optional(),
  browserVersion: z.string().optional(),
  os: z.string().optional(),
  osVersion: z.string().optional(),
  deviceType: z.string().optional(),
  country: z.string().optional(),
  errorType: z.string(),
  errorMessage: z.string(),
  originalStack: z.string().optional(),
  errorMechanism: z.string().optional(),
  fingerprint: z.string(),
  fingerprintVersion: z.number().int().positive(),
  handled: z.boolean(),
  breadcrumbs: z.array(z.string()),
  ingestFlags: z.array(z.string()),
  availability: z.object({
    stack: z.boolean(),
    breadcrumbs: z.boolean(),
    visitor: z.boolean(),
    release: z.boolean(),
  }),
  relatedApis: z.array(
    z.object({
      eventId: z.string(),
      timestamp: isoTime,
      method: z.string(),
      url: z.string(),
      status: z.number().int().nonnegative(),
      failure: z.string().optional(),
      durationMs: z.number().nonnegative(),
      route: z.string().optional(),
    }),
  ),
  mappedStack: mappedStackSchema.optional(),
});

export const issueEventsResponseSchema = z.object({
  events: z.array(eventDetailSchema),
  nextCursor: z.string().optional(),
});

export type IssueDetailResponse = z.infer<typeof issueDetailResponseSchema>;
export type EventDetail = z.infer<typeof eventDetailSchema>;

export type IssueFilters = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  /** Server-side substring match against the Issue title (latest error message). */
  title?: string;
  errorType?: string;
  fingerprint?: string;
  userId?: string;
  release?: string;
  browser?: string;
  deviceType?: string;
  country?: string;
  route?: string;
  status?: IssueStatus;
  sort: "events" | "users" | "last_seen";
  cursor?: string;
};

export function getIssues(filters: IssueFilters, signal?: AbortSignal) {
  const parameters = serializeIssueFilters(filters);
  return requestJSON(
    issuesResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/issues?${parameters.toString()}`,
    { signal },
  );
}

export function getIssueOverview(filters: IssueFilters, signal?: AbortSignal) {
  const parameters = serializeIssueFilters({
    ...filters,
    cursor: undefined,
    status: undefined,
    sort: "events",
  });
  return requestJSON(
    issueOverviewResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/issues/overview?${parameters.toString()}`,
    { signal },
  );
}

export function getIssueDetail(filters: IssueFilters, fingerprint: string, signal?: AbortSignal) {
  const parameters = serializeIssueFilters({ ...filters, cursor: undefined });
  return requestJSON(
    issueDetailResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(fingerprint)}?${parameters.toString()}`,
    { signal },
  );
}

export function getIssueEvents(
  filters: IssueFilters,
  fingerprint: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  const parameters = serializeIssueFilters({ ...filters, cursor });
  parameters.set("limit", "25");
  return requestJSON(
    issueEventsResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(fingerprint)}/events?${parameters.toString()}`,
    { signal },
  );
}

export function getEvent(eventId: string, signal?: AbortSignal) {
  return requestJSON(eventDetailSchema, `/api/v1/events/${encodeURIComponent(eventId)}`, {
    signal,
  });
}

const issueStateSchema = z.object({
  projectId: z.string(),
  fingerprint: z.string(),
  fingerprintVersion: z.number().int().positive(),
  status: issueStatusSchema,
  assigneeUserId: z.string().optional(),
  resolvedInReleaseId: z.string().optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
});

export function updateIssue(
  filters: IssueFilters,
  fingerprint: string,
  patch: { status?: IssueStatus; assigneeUserId?: string },
) {
  const parameters = serializeIssueFilters({ ...filters, cursor: undefined });
  return requestJSON(
    issueStateSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(fingerprint)}?${parameters.toString()}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(patch),
    },
  );
}

export function defaultIssueFilters(projectId: string, now = new Date()): IssueFilters {
  const to = new Date(now);
  to.setUTCSeconds(0, 0);
  return { projectId, from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to, sort: "events" };
}

export function parseIssueFilters(
  projectId: string,
  search: URLSearchParams,
  now = new Date(),
): IssueFilters {
  const fallback = defaultIssueFilters(projectId, now);
  const from = parseUTC(search.get("from"));
  const to = parseUTC(search.get("to"));
  const validRange =
    from && to && to > from && to.getTime() - from.getTime() <= 30 * 24 * 60 * 60 * 1000;
  const status = issueStatusSchema.safeParse(clean(search.get("status")));
  const sortValue = search.get("sort");
  const sort = sortValue === "users" || sortValue === "last_seen" ? sortValue : "events";
  const cursor = clean(search.get("cursor"));
  return {
    projectId,
    from: validRange ? from : fallback.from,
    to: validRange ? to : fallback.to,
    environment: clean(search.get("environment")),
    title: clean(search.get("title") ?? search.get("search"))?.slice(0, 200),
    errorType: clean(search.get("errorType")),
    fingerprint: clean(search.get("fingerprint")),
    userId: clean(search.get("userId") ?? search.get("user.id")),
    release: clean(search.get("release")),
    browser: clean(search.get("browser")),
    deviceType: clean(search.get("deviceType")),
    country: clean(search.get("country")),
    route: clean(search.get("route")),
    status: status.success ? status.data : undefined,
    sort,
    cursor: cursor && /^[A-Za-z0-9_-]{1,512}$/.test(cursor) ? cursor : undefined,
  };
}

export function serializeIssueFilters(filters: IssueFilters) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    sort: filters.sort,
  });
  for (const [key, value] of [
    ["environment", filters.environment],
    ["title", filters.title],
    ["errorType", filters.errorType],
    ["fingerprint", filters.fingerprint],
    ["userId", filters.userId],
    ["release", filters.release],
    ["browser", filters.browser],
    ["deviceType", filters.deviceType],
    ["country", filters.country],
    ["route", filters.route],
    ["status", filters.status],
    ["cursor", filters.cursor],
  ] as const) {
    if (value) parameters.set(key, value);
  }
  return parameters;
}

function parseUTC(value: string | null) {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function clean(value: string | null) {
  const trimmed = value?.trim();
  return trimmed && !/[\0\r\n]/.test(trimmed) ? trimmed : undefined;
}
