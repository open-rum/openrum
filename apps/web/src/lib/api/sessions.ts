import { z } from "zod";
import { requestJSON } from "./client";

const isoTime = z.iso.datetime({ offset: true });
const facetSchema = z.object({ value: z.string(), sessions: z.number().int().nonnegative() });

export const sessionSummarySchema = z.object({
  sessionId: z.uuid(),
  visitorId: z.string().optional(),
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
