import { z } from "zod";
import { requestJSON } from "./client";

const isoTime = z.iso.datetime({ offset: true });
const metric = z.object({
  p75: z.number().nullable(),
  samples: z.number().int().nonnegative(),
  sufficient: z.boolean(),
});
const route = z.object({
  route: z.string(),
  pageViews: z.number().int().nonnegative(),
  lcp: metric,
  inp: metric,
  cls: metric,
});
const detail = z.object({
  route: z.string(),
  metric: z.enum(["LCP", "INP", "CLS"]),
  trend: z.array(z.object({ bucket: isoTime, metric })),
  distribution: z.array(
    z.object({ from: z.number(), to: z.number(), samples: z.number().int().nonnegative() }),
  ),
  browsers: z.array(z.object({ value: z.string(), metric })),
  deviceTypes: z.array(z.object({ value: z.string(), metric })),
  samples: z.array(
    z.object({
      eventId: z.string(),
      timestamp: isoTime,
      value: z.number(),
      pageUrl: z.string(),
      browser: z.string().optional(),
      deviceType: z.string().optional(),
      country: z.string().optional(),
      release: z.string().optional(),
    }),
  ),
});
export const performanceResponseSchema = z.object({
  from: isoTime,
  to: isoTime,
  routes: z.array(route),
  trend: z.array(
    z.object({
      bucket: isoTime,
      lcp: metric,
      inp: metric,
      cls: metric,
    }),
  ),
  detail: detail.optional(),
});
export type PerformanceResponse = z.infer<typeof performanceResponseSchema>;
export type PerformanceMetricName = "LCP" | "INP" | "CLS";
export type PerformanceFilters = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  release?: string;
  route?: string;
  metric: PerformanceMetricName;
};

export function getPerformance(filters: PerformanceFilters, signal?: AbortSignal) {
  const parameters = serializePerformanceFilters(filters);
  return requestJSON(
    performanceResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/performance?${parameters}`,
    { signal },
  );
}
export function defaultPerformanceFilters(
  projectId: string,
  search = new URLSearchParams(),
  now = new Date(),
): PerformanceFilters {
  const to = parseTime(search.get("to")) ?? new Date(now.setUTCSeconds(0, 0));
  const candidateFrom = parseTime(search.get("from"));
  const from =
    candidateFrom && candidateFrom < to && to.getTime() - candidateFrom.getTime() <= 30 * 86400000
      ? candidateFrom
      : new Date(to.getTime() - 86400000);
  const candidateMetric = search.get("metric")?.toUpperCase();
  return {
    projectId,
    from,
    to,
    environment: clean(search.get("environment")),
    release: clean(search.get("release")),
    route: clean(search.get("route")),
    metric: candidateMetric === "INP" || candidateMetric === "CLS" ? candidateMetric : "LCP",
  };
}
export function serializePerformanceFilters(filters: PerformanceFilters) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    metric: filters.metric,
  });
  if (filters.environment) parameters.set("environment", filters.environment);
  if (filters.release) parameters.set("release", filters.release);
  if (filters.route) parameters.set("route", filters.route);
  return parameters;
}
export function formatPerformanceMetric(value: number | null, metric: string) {
  if (value === null) return "—";
  return metric === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`;
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
