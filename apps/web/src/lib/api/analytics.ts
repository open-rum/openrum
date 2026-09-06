import { z } from "zod";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

const isoTimeSchema = z.iso.datetime({ offset: true });
const metricSchema = z.object({
  events: z.number().int().nonnegative(),
  estimated: z.number().nonnegative(),
  uniqueUsers: z.number().int().nonnegative(),
  uniqueSessions: z.number().int().nonnegative(),
  approximate: z.boolean(),
});

export const behaviorAnalyticsSchema = z.object({
  from: isoTimeSchema,
  to: isoTimeSchema,
  dimension: z.string(),
  interval: z.string(),
  totals: metricSchema,
  trend: z.array(z.object({ bucket: isoTimeSchema, metric: metricSchema })),
  breakdown: z.array(z.object({ value: z.string(), metric: metricSchema })),
  catalog: z.array(z.object({ kind: z.string(), name: z.string(), metric: metricSchema })),
  properties: z.array(
    z.object({
      name: z.string(),
      events: z.number().int().nonnegative(),
      cardinality: z.number().int().nonnegative(),
    }),
  ),
  freshness: z.object({
    latestReceivedAt: isoTimeSchema.nullable(),
    ageSeconds: z.number().nonnegative().nullable(),
    stale: z.boolean(),
  }),
  sampleCount: z.number().int().nonnegative(),
  rowLimit: z.number().int().positive(),
});

export const behaviorSamplesSchema = z.object({
  samples: z.array(
    z.object({
      eventId: z.uuid(),
      timestamp: isoTimeSchema,
      kind: z.string(),
      name: z.string(),
      route: z.string().optional(),
      pageUrl: z.string().optional(),
      browser: z.string().optional(),
      device: z.string().optional(),
      country: z.string().optional(),
      sessionId: z.uuid(),
      visitorId: z.string().optional(),
      attributes: z.record(z.string(), z.string()),
      breadcrumbs: z.array(z.string()),
    }),
  ),
  limit: z.number().int().positive(),
});

export type BehaviorAnalyticsResponse = z.infer<typeof behaviorAnalyticsSchema>;
export type BehaviorSample = z.infer<typeof behaviorSamplesSchema>["samples"][number];
export type BehaviorDimension = "country" | "device" | "browser" | "source" | `property:${string}`;
export type BehaviorKind = "page_view" | "navigation" | "click" | "custom";

const funnelStepSchema = z.object({ kind: z.string(), name: z.string() });
export const funnelResultSchema = z.object({
  from: isoTimeSchema,
  to: isoTimeSchema,
  dimension: z.string(),
  windowSeconds: z.number().int().positive(),
  identity: z.literal("session_id"),
  approximate: z.boolean(),
  steps: z.array(
    funnelStepSchema.extend({
      index: z.number().int().positive(),
      sessions: z.number().int().nonnegative(),
      conversionFromPrevious: z.number().min(0).max(1).nullable(),
      conversionFromFirst: z.number().min(0).max(1).nullable(),
    }),
  ),
  breakdown: z.array(
    z.object({ value: z.string(), stepCounts: z.array(z.number().int().nonnegative()) }),
  ),
  samples: z.array(
    z.object({
      sessionId: z.uuid(),
      reachedStep: z.number().int().positive(),
      lastSeenAt: isoTimeSchema,
    }),
  ),
});

export type FunnelStep = z.infer<typeof funnelStepSchema>;
export type FunnelResult = z.infer<typeof funnelResultSchema>;
export type FunnelDefinition = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  dimension: BehaviorDimension;
  windowSeconds: 1800 | 3600 | 86400;
  steps: FunnelStep[];
};

export const pathResultSchema = z.object({
  from: isoTimeSchema,
  to: isoTimeSchema,
  depth: z.number().int().min(2).max(5),
  topN: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  identity: z.literal("session_id"),
  approximate: z.boolean(),
  totalSessions: z.number().int().nonnegative(),
  paths: z.array(
    z.object({
      events: z.array(z.string()).max(5),
      sessions: z.number().int().nonnegative(),
      share: z.number().min(0).max(1),
    }),
  ),
});

export const retentionResultSchema = z.object({
  from: isoTimeSchema,
  to: isoTimeSchema,
  weeks: z.number().int().min(4).max(12),
  identity: z.literal("anonymous_user_id"),
  approximate: z.boolean(),
  definition: z.string(),
  cohorts: z.array(
    z.object({
      cohortWeek: isoTimeSchema,
      users: z.number().int().nonnegative(),
      retention: z.array(
        z.object({
          weekIndex: z.number().int().nonnegative(),
          users: z.number().int().nonnegative(),
          rate: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
});

export type PathResult = z.infer<typeof pathResultSchema>;
export type RetentionResult = z.infer<typeof retentionResultSchema>;

export type BehaviorFilters = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  eventKind?: BehaviorKind;
  eventName?: string;
  dimension: BehaviorDimension;
};

export function defaultBehaviorFilters(
  projectId: string,
  search = new URLSearchParams(),
  now = new Date(),
): BehaviorFilters {
  const to = parseDate(search.get("to")) ?? roundedMinute(now);
  const from = parseDate(search.get("from")) ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const dimension = parseDimension(search.get("dimension"));
  const kind = parseKind(search.get("eventKind"));
  const eventName = clean(search.get("eventName"), 80);
  const environment = clean(search.get("environment"), 64);
  if (from >= to || to.getTime() - from.getTime() > 30 * 24 * 60 * 60 * 1000) {
    return { projectId, from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to, dimension };
  }
  return { projectId, from, to, dimension, eventKind: kind, eventName, environment };
}

export function serializeBehaviorFilters(filters: BehaviorFilters) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    dimension: filters.dimension,
  });
  if (filters.environment) parameters.set("environment", filters.environment);
  if (filters.eventKind) parameters.set("eventKind", filters.eventKind);
  if (filters.eventName) parameters.set("eventName", filters.eventName);
  return parameters;
}

export function getBehaviorAnalytics(filters: BehaviorFilters, signal?: AbortSignal) {
  return requestJSON(
    behaviorAnalyticsSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/analytics/events?${serializeBehaviorFilters(filters)}`,
    { signal },
  );
}

export function getBehaviorSamples(filters: BehaviorFilters, signal?: AbortSignal) {
  const sampleFilters = { ...filters };
  const earliest = sampleFilters.to.getTime() - 24 * 60 * 60 * 1000;
  if (sampleFilters.from.getTime() < earliest) sampleFilters.from = new Date(earliest);
  return requestJSON(
    behaviorSamplesSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/analytics/events/samples?${serializeBehaviorFilters(sampleFilters)}`,
    { signal },
  );
}

export function queryFunnel(definition: FunnelDefinition, signal?: AbortSignal) {
  return requestJSON(
    funnelResultSchema,
    `/api/v1/projects/${encodeURIComponent(definition.projectId)}/analytics/funnels/query`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({
        from: definition.from.toISOString(),
        to: definition.to.toISOString(),
        environment: definition.environment,
        dimension: definition.dimension,
        windowSeconds: definition.windowSeconds,
        steps: definition.steps,
      }),
    },
  );
}

export function getPaths(
  input: {
    projectId: string;
    from: Date;
    to: Date;
    environment?: string;
    depth: 2 | 3 | 4 | 5;
    topN: 5 | 10 | 20;
  },
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    depth: String(input.depth),
    topN: String(input.topN),
  });
  if (input.environment) parameters.set("environment", input.environment);
  return requestJSON(
    pathResultSchema,
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/analytics/paths?${parameters}`,
    { signal },
  );
}

export function getRetention(
  input: { projectId: string; from: Date; to: Date; environment?: string; weeks: 4 | 8 | 12 },
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    weeks: String(input.weeks),
  });
  if (input.environment) parameters.set("environment", input.environment);
  return requestJSON(
    retentionResultSchema,
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/analytics/retention?${parameters}`,
    { signal },
  );
}

function parseDimension(value: string | null): BehaviorDimension {
  if (value === "device" || value === "browser" || value === "source") return value;
  if (value?.startsWith("property:") && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(value.slice(9))) {
    return value as `property:${string}`;
  }
  return "country";
}

function parseKind(value: string | null): BehaviorKind | undefined {
  if (value === "page_view" || value === "navigation" || value === "click" || value === "custom")
    return value;
  return undefined;
}

function parseDate(value: string | null) {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}

function clean(value: string | null, maximum: number) {
  const result = value?.trim();
  return result && result.length <= maximum && !/[\0\r\n]/.test(result) ? result : undefined;
}
