import { z, type ZodType } from "zod";
import { HTTPError, csrfHeaders, redirectToLogin } from "@/lib/auth/session";
import type { OverviewFilters } from "@/lib/filters/schema";

const errorEnvelopeSchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      requestId: z.string().optional(),
    })
    .optional(),
});

const countMetricSchema = z.object({ value: z.number(), samples: z.number().int().nonnegative() });
const cardinalityMetricSchema = z.object({
  value: z.number().int().nonnegative(),
  samples: z.number().int().nonnegative(),
  approximate: z.boolean(),
});
const rateMetricSchema = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  numeratorSamples: z.number().int().nonnegative(),
  denominatorSamples: z.number().int().nonnegative(),
});
const vitalMetricSchema = z.object({
  p75: z.number().nullable(),
  samples: z.number().int().nonnegative(),
  sufficient: z.boolean(),
});
const kpisSchema = z.object({
  pageViews: countMetricSchema,
  uniqueUsers: cardinalityMetricSchema,
  errorRate: rateMetricSchema,
  apiFailureRate: rateMetricSchema,
  lcp: vitalMetricSchema,
  inp: vitalMetricSchema,
  cls: vitalMetricSchema,
});
const isoTimeSchema = z.iso.datetime({ offset: true });

export const overviewResponseSchema = z.object({
  from: isoTimeSchema,
  to: isoTimeSchema,
  intervalSeconds: z.number().int().positive(),
  kpis: kpisSchema,
  comparison: z.object({
    from: isoTimeSchema,
    to: isoTimeSchema,
    previous: kpisSchema,
    changes: z.object({
      pageViewsPercent: z.number().nullable(),
      uniqueUsersPercent: z.number().nullable(),
      errorRatePoints: z.number().nullable(),
      apiFailureRatePoints: z.number().nullable(),
      lcpPercent: z.number().nullable(),
      inpPercent: z.number().nullable(),
      clsPercent: z.number().nullable(),
    }),
  }),
  series: z.array(
    z.object({
      bucket: isoTimeSchema,
      pageViews: countMetricSchema,
      uniqueUsers: cardinalityMetricSchema,
      errorRate: rateMetricSchema,
      apiFailureRate: rateMetricSchema,
      lcp: vitalMetricSchema,
      inp: vitalMetricSchema,
      cls: vitalMetricSchema,
    }),
  ),
  topIssues: z.array(
    z.object({
      fingerprint: z.string(),
      title: z.string(),
      events: z.number().int().nonnegative(),
      users: z.number().int().nonnegative(),
      lastSeenAt: isoTimeSchema.nullable(),
    }),
  ),
  slowApis: z.array(
    z.object({
      method: z.string(),
      url: z.string(),
      requests: z.number().int().nonnegative(),
      failures: z.number().int().nonnegative(),
      failureRate: z.number().nullable(),
      durationP95: z.number().nullable(),
    }),
  ),
  freshness: z.object({
    latestReceivedAt: isoTimeSchema.nullable(),
    ageSeconds: z.number().nonnegative().nullable(),
    stale: z.boolean(),
  }),
});

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

export const connectionStatusSchema = z.object({
  keyConfigured: z.boolean(),
  lastSdkSeenAt: isoTimeSchema.nullable(),
  lastEventReceivedAt: isoTimeSchema.nullable(),
  lastEventQueryableAt: isoTimeSchema.nullable(),
  lastRejectReason: z.string().nullable(),
  lastRejectAt: isoTimeSchema.nullable(),
});

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

const projectKeySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: isoTimeSchema.nullable(),
  revokedAt: isoTimeSchema.nullable(),
  createdAt: isoTimeSchema,
  dsn: z.string().optional(),
  isDefault: z.boolean(),
});

const projectKeyListSchema = z.object({ keys: z.array(projectKeySchema) });

type RequestOptions = RequestInit & { redirectOnUnauthorized?: boolean };

export async function requestJSON<T>(
  schema: ZodType<T>,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { redirectOnUnauthorized = true, ...init } = options;
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...init.headers },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);
    const detail = parsed.success ? parsed.data.error : undefined;
    if (response.status === 401 && redirectOnUnauthorized) redirectToLogin(true);
    throw new HTTPError(
      response.status,
      detail?.code ?? "REQUEST_FAILED",
      detail?.requestId ?? response.headers.get("X-Request-ID") ?? "",
      detail?.message ?? "请求失败，请稍后重试。",
    );
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new HTTPError(
      502,
      "INVALID_API_RESPONSE",
      response.headers.get("X-Request-ID") ?? "",
      "服务端返回了无法识别的数据。请刷新重试。",
    );
  }
  return result.data;
}

export function getOverview(filters: OverviewFilters, signal?: AbortSignal, maxPoints?: number) {
  const parameters = new URLSearchParams({
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
  });
  if (filters.environment) parameters.set("environment", filters.environment);
  if (filters.release) parameters.set("release", filters.release);
  if (filters.route) parameters.set("route", filters.route);
  if (maxPoints) parameters.set("maxPoints", String(maxPoints));
  return requestJSON(
    overviewResponseSchema,
    `/api/v1/projects/${encodeURIComponent(filters.projectId)}/overview?${parameters.toString()}`,
    { signal },
  );
}

export function getConnectionStatus(projectId: string, signal?: AbortSignal) {
  return requestJSON(
    connectionStatusSchema,
    `/api/v1/projects/${encodeURIComponent(projectId)}/connection-status`,
    { signal },
  );
}

export function sendTestEvent(projectId: string) {
  return requestJSON(
    z.object({ eventId: z.string(), status: z.literal("accepted"), acceptedAt: isoTimeSchema }),
    `/api/v1/projects/${encodeURIComponent(projectId)}/test-event`,
    { method: "POST", headers: csrfHeaders() },
  );
}

export function createOnboardingKey(projectId: string) {
  return requestJSON(projectKeySchema, `/api/v1/projects/${encodeURIComponent(projectId)}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ name: "Onboarding browser key" }),
  });
}

export function listProjectKeys(projectId: string, signal?: AbortSignal) {
  return requestJSON(
    projectKeyListSchema,
    `/api/v1/projects/${encodeURIComponent(projectId)}/keys`,
    { signal },
  );
}

export function rotateProjectKey(projectId: string, keyId: string) {
  return requestJSON(
    projectKeySchema,
    `/api/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(keyId)}/rotate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({}),
    },
  );
}
