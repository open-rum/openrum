import { z } from "zod";
import { requestJSON } from "./client";

const isoTime = z.iso.datetime({ offset: true });
const endpoint = z.object({
  method: z.string(),
  url: z.string(),
  requests: z.number().int().nonnegative(),
  estimated: z.number().nonnegative(),
  failures: z.number().int().nonnegative(),
  clientErrors: z.number().int().nonnegative(),
  serverErrors: z.number().int().nonnegative(),
  networkErrors: z.number().int().nonnegative(),
  p50: z.number().nullable(),
  p75: z.number().nullable(),
  p95: z.number().nullable(),
  sufficient: z.boolean(),
});
const trendPoint = z.object({
  bucket: isoTime,
  requests: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  clientErrors: z.number().int().nonnegative(),
  p95: z.number().nullable(),
});
const summary = z.object({
  requests: z.number().int().nonnegative(),
  estimated: z.number().nonnegative(),
  failures: z.number().int().nonnegative(),
  clientErrors: z.number().int().nonnegative(),
  serverErrors: z.number().int().nonnegative(),
  networkErrors: z.number().int().nonnegative(),
  p50: z.number().nullable(),
  p75: z.number().nullable(),
  p95: z.number().nullable(),
  endpoints: z.number().int().nonnegative(),
});
const dimensionFacet = z.object({
  value: z.string(),
  requests: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  p95: z.number().nullable(),
});
const detail = z.object({
  endpoint,
  trend: z.array(trendPoint),
  routes: z.array(
    z.object({
      route: z.string(),
      requests: z.number().int().nonnegative(),
      failures: z.number().int().nonnegative(),
    }),
  ),
  statuses: z.array(
    z.object({
      status: z.number().int().nonnegative(),
      failure: z.string().optional(),
      requests: z.number().int().nonnegative(),
    }),
  ),
  latency: z.array(
    z.object({
      fromMs: z.number().nonnegative(),
      toMs: z.number().nonnegative().nullable(),
      requests: z.number().int().nonnegative(),
    }),
  ),
  payload: z.object({
    samples: z.number().int().nonnegative(),
    p50: z.number().nullable(),
    p95: z.number().nullable(),
  }),
  dimensions: z.object({
    browsers: z.array(dimensionFacet),
    operatingSystems: z.array(dimensionFacet),
    devices: z.array(dimensionFacet),
    countries: z.array(dimensionFacet),
    releases: z.array(dimensionFacet),
  }),
  samples: z.array(
    z.object({
      eventId: z.string(),
      timestamp: isoTime,
      status: z.number().int().nonnegative(),
      failure: z.string().optional(),
      durationMs: z.number().nonnegative(),
      route: z.string().optional(),
      pageUrl: z.string(),
      release: z.string().optional(),
      browser: z.string().optional(),
      sessionId: z.string(),
      traceId: z.string().optional(),
    }),
  ),
});
const facet = z.object({ value: z.string(), requests: z.number().int().nonnegative() });
export const apisResponseSchema = z.object({
  from: isoTime,
  to: isoTime,
  summary,
  previous: summary.optional(),
  trend: z.array(trendPoint),
  facets: z.object({
    methods: z.array(facet),
    releases: z.array(facet),
    routes: z.array(facet),
  }),
  endpoints: z.array(endpoint),
  truncated: z.boolean(),
  detail: detail.optional(),
});
export type APIsResponse = z.infer<typeof apisResponseSchema>;
export type APISummary = z.infer<typeof summary>;
export type APITrendPoint = z.infer<typeof trendPoint>;
export const apiSorts = ["requests", "failures", "failureRate", "p95", "impact"] as const;
export type APISort = (typeof apiSorts)[number];
export const apiSortLabels: Record<APISort, string> = {
  requests: "请求量",
  failures: "失败数",
  failureRate: "失败率",
  p95: "P95 延迟",
  impact: "总耗时（请求量 × P95）",
};
export const apiMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export type APIFilters = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  release?: string;
  route?: string;
  /** Narrows the ranked list. */
  methods: string[];
  /** With url, selects the endpoint whose detail is shown. */
  method?: string;
  url?: string;
  search?: string;
  sort: APISort;
};

export function getAPIs(filters: APIFilters, signal?: AbortSignal) {
  const parameters = serializeAPIFilters(filters);
  parameters.set("compare", "previous");
  return requestJSON(
    apisResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/apis?${parameters}`,
    { signal },
  );
}
export function defaultAPIFilters(
  projectId: string,
  search: URLSearchParams,
  now = new Date(),
): APIFilters {
  const to = parseTime(search.get("to")) ?? new Date(now.setUTCSeconds(0, 0));
  const candidateFrom = parseTime(search.get("from"));
  const from =
    candidateFrom && candidateFrom < to && to.getTime() - candidateFrom.getTime() <= 30 * 86400000
      ? candidateFrom
      : new Date(to.getTime() - 86400000);
  const sortValue = search.get("sort");
  const requested = new Set(search.getAll("methods").map((value) => value.toUpperCase()));
  return {
    projectId,
    from,
    to,
    environment: clean(search.get("environment")),
    release: clean(search.get("release")),
    route: clean(search.get("route")),
    methods: apiMethods.filter((method) => requested.has(method)),
    method: clean(search.get("method")),
    url: clean(search.get("url")),
    search: clean(search.get("search")),
    sort: apiSorts.find((value) => value === sortValue) ?? "requests",
  };
}
export function serializeAPIFilters(filters: APIFilters) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    sort: filters.sort,
  });
  for (const [key, value] of [
    ["environment", filters.environment],
    ["release", filters.release],
    ["route", filters.route],
    ["method", filters.method],
    ["url", filters.url],
    ["search", filters.search],
  ] as const)
    if (value) parameters.set(key, value);
  for (const method of filters.methods) parameters.append("methods", method);
  return parameters;
}
/** Quantiles below this many requests are ranked last and labelled as insufficient. */
export const minimumAPISamples = 75;

export function formatAPIDuration(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

export function apiFailureRate(endpoint: { requests: number; failures: number }) {
  return endpoint.requests ? (endpoint.failures / endpoint.requests) * 100 : 0;
}

export function formatAPIBytes(value: number | null) {
  if (value === null) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function formatAPILatencyBucket(bucket: { fromMs: number; toMs: number | null }) {
  const edge = (value: number) => (value >= 1000 ? `${value / 1000}s` : `${value}ms`);
  return bucket.toMs === null
    ? `≥ ${edge(bucket.fromMs)}`
    : `${edge(bucket.fromMs)}–${edge(bucket.toMs)}`;
}
function parseTime(value: string | null) {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
function clean(value: string | null) {
  const result = value?.trim();
  return result && !/[\0\r\n]/.test(result) ? result : undefined;
}
