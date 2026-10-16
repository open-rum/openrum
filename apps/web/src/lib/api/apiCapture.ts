import { apiFetch, csrfHeaders } from "@/lib/auth/session";

const protectedRequest = { redirectOnUnauthorized: true } as const;

/**
 * How long a stored header snapshot stays readable. The server enforces it: the
 * ClickHouse column TTL and the samples query both use `capture.RetentionDays`. This copy only
 * words the Console's explanations, and the settings page prefers the number the server sends.
 */
export const HEADER_RETENTION_DAYS = 3;

export type CaptureRule = {
  id: string;
  /** An HTTP method, or `*` for any. */
  method: string;
  /** Matched against the endpoint as API monitoring shows it, `:id` standing for an identifier. */
  pattern: string;
  requestHeaders: string[];
  responseHeaders: string[];
  /** Opt in to a redacted, size-limited copy of each body. */
  requestBody: boolean;
  responseBody: boolean;
  note?: string;
};

export type APICapture = {
  rules: CaptureRule[];
  retentionDays: number;
  maxRules: number;
  maxHeaders: number;
};

/** Largest body copy kept, in characters. The server enforces it; this only words the Console. */
export const BODY_LIMIT_KB = 4;

export const captureMethods = ["*", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Splits what a person typed into header names: commas, spaces and newlines all separate. */
export function splitHeaderNames(text: string): string[] {
  const names: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    const name = part.trim().toLowerCase();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function apiCaptureHref(projectId: string, endpoint?: { method: string; url: string }) {
  const base = `/settings/project/${encodeURIComponent(projectId)}/api-capture`;
  if (!endpoint) return base;
  const query = new URLSearchParams({ method: endpoint.method, url: endpoint.url });
  return `${base}?${query.toString()}`;
}

export function getAPICapture(projectId: string, signal?: AbortSignal) {
  return apiFetch<APICapture>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/api-capture`,
    { signal },
    protectedRequest,
  );
}

export function updateAPICapture(projectId: string, rules: CaptureRule[]) {
  return apiFetch<APICapture>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/api-capture`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ rules }),
    },
    protectedRequest,
  );
}
