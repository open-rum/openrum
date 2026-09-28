import { z } from "zod";
import { requestJSON } from "./client";

// The metric catalog is owned by the backend (internal/catalog). The Console reads it to
// build the editor and never mirrors its rules by hand; a shared golden file and case
// matrix keep the two sides from drifting.

const unitSchema = z.enum(["count", "ratio", "ms", "score", "number"]);
const shapeSchema = z.enum(["total", "series", "breakdown", "seriesByDimension", "table"]);

export const catalogMetricSchema = z.object({
  id: z.string(),
  family: z.string(),
  label: z.string(),
  description: z.string(),
  source: z.string(),
  unit: unitSchema,
  weighting: z.enum(["estimated", "sampled", "none"]),
  kind: z.string(),
  direction: z.enum(["up", "down", "neutral"]),
  semantic: z.string().optional(),
  shapes: z.array(shapeSchema),
  dimensions: z.array(z.string()),
  propertyDimensions: z.boolean(),
  additiveDimensions: z.array(z.string()),
  filters: z.array(z.string()),
  compare: z.boolean(),
  compositionGroup: z.string().optional(),
  additiveOverTime: z.boolean(),
  minSamples: z.number().optional(),
  minIntervalSeconds: z.number(),
  requiresMeasurementKey: z.boolean(),
  approximate: z.boolean(),
  thresholds: z.object({ good: z.number(), poor: z.number() }).optional(),
});
export type CatalogMetric = z.infer<typeof catalogMetricSchema>;

export const metricCatalogSchema = z.object({
  version: z.number().int(),
  families: z.array(z.object({ id: z.string(), label: z.string() })),
  metrics: z.array(catalogMetricSchema),
  dimensions: z.array(z.object({ id: z.string(), label: z.string() })),
  filters: z.array(z.string()),
  limits: z.object({
    maxMetrics: z.record(z.string(), z.number()),
    maxBreakdownTopN: z.number(),
    maxDimensionTopN: z.number(),
    maxTableTopN: z.number(),
  }),
});
export type MetricCatalog = z.infer<typeof metricCatalogSchema>;

const metricValueSchema = z.object({
  value: z.number().nullable(),
  samples: z.number(),
  sufficient: z.boolean(),
  numerator: z.number().optional(),
  denominator: z.number().optional(),
});
export type MetricValue = z.infer<typeof metricValueSchema>;
const valuesSchema = z.record(z.string(), metricValueSchema);
const changeSchema = z.object({ percent: z.number().optional(), points: z.number().optional() });
export type MetricChange = z.infer<typeof changeSchema>;
const pointsSchema = z.array(metricValueSchema.nullable());

export const metricMetaSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  unit: unitSchema,
  weighting: z.string(),
  kind: z.string(),
  direction: z.enum(["up", "down", "neutral"]),
  semantic: z.string().optional(),
  approximate: z.boolean(),
  additiveOverTime: z.boolean(),
  additive: z.boolean(),
  minSamples: z.number().optional(),
  thresholds: z.object({ good: z.number(), poor: z.number() }).optional(),
});
export type MetricMeta = z.infer<typeof metricMetaSchema>;

export const metricsResultSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  shape: shapeSchema,
  source: z.string(),
  dimension: z.string().optional(),
  metrics: z.array(metricMetaSchema),
  intervalSeconds: z.number().optional(),
  buckets: z.array(z.iso.datetime({ offset: true })).optional(),
  totals: valuesSchema.optional(),
  comparison: z
    .object({
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
      offsetSeconds: z.number(),
      totals: valuesSchema.optional(),
      changes: z.record(z.string(), changeSchema).optional(),
    })
    .optional(),
  series: z.array(z.object({ metric: z.string(), points: pointsSchema })).optional(),
  previousSeries: z.array(z.object({ metric: z.string(), points: pointsSchema })).optional(),
  rows: z
    .array(
      z.object({
        value: z.string(),
        values: valuesSchema,
        previous: valuesSchema.optional(),
        changes: z.record(z.string(), changeSchema).optional(),
        sparkline: pointsSchema.optional(),
      }),
    )
    .optional(),
  other: valuesSchema.optional(),
  groups: z
    .array(z.object({ value: z.string(), other: z.boolean().optional(), points: pointsSchema }))
    .optional(),
  limitReached: z.boolean(),
  topN: z.number().optional(),
  newIssuesLookbackFrom: z.iso.datetime({ offset: true }).optional(),
  freshness: z.object({
    latestReceivedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    ageSeconds: z.number().nullable().optional(),
    stale: z.boolean().optional(),
  }),
});
export type MetricsResult = z.infer<typeof metricsResultSchema>;

export type MetricsShape = z.infer<typeof shapeSchema>;
export type MetricsFilterKey =
  | "release"
  | "route"
  | "country"
  | "browser"
  | "device"
  | "apiMethod"
  | "apiUrl"
  | "eventKind"
  | "eventName";

export type MetricsQueryParams = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  maxPoints: number;
  metrics: string[];
  shape: MetricsShape;
  dimension?: string;
  measurement?: string;
  filters?: Partial<Record<MetricsFilterKey, string>>;
  compare?: boolean;
  topN?: number;
  sort?: string;
  order?: "asc" | "desc";
  sparkline?: boolean;
  stack?: "metrics" | "dimension";
  /** Pins a split to these values, in order, instead of ranking the top N. */
  groups?: string[];
};

export function getMetricCatalog(projectId: string, signal?: AbortSignal) {
  return requestJSON(
    metricCatalogSchema,
    `/api/v1/projects/${encodeURIComponent(projectId)}/metrics/catalog`,
    { signal },
  );
}

/** Serializes a query exactly as the backend parses it: defaults are omitted. */
export function metricsQueryString(params: MetricsQueryParams): string {
  const search = new URLSearchParams({
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    shape: params.shape,
    maxPoints: String(params.maxPoints),
  });
  if (params.environment) search.set("environment", params.environment);
  for (const metric of params.metrics) search.append("metric", metric);
  if (params.dimension) search.set("dimension", params.dimension);
  if (params.measurement) search.set("measurement", params.measurement);
  for (const [key, value] of Object.entries(params.filters ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    if (value) search.set(key, value);
  if (params.compare) search.set("compare", "previous");
  if (params.topN) search.set("topN", String(params.topN));
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.sparkline) search.set("sparkline", "true");
  if (params.stack) search.set("stack", params.stack);
  for (const group of params.groups ?? []) search.append("group", group);
  return search.toString();
}

export function queryMetrics(params: MetricsQueryParams, signal?: AbortSignal) {
  return requestJSON(
    metricsResultSchema,
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/metrics/query?${metricsQueryString(params)}`,
    { signal },
  );
}
