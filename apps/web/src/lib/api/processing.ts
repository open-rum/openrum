import { apiFetch, csrfHeaders } from "@/lib/auth/session";

const protectedRequest = { redirectOnUnauthorized: true } as const;

export type URLRuleTarget = "page" | "api" | "both";

export type URLRule = {
  id: string;
  target: URLRuleTarget;
  pattern: string;
  note?: string;
};

export type URLRules = {
  rules: URLRule[];
};

export type ScrubPattern = {
  id: string;
  expression: string;
  note?: string;
};

export type ScrubRules = {
  patterns: ScrubPattern[];
  sensitiveKeys: string[];
};

export const urlRuleTargetLabels: Record<URLRuleTarget, string> = {
  page: "页面地址",
  api: "API 地址",
  both: "两者",
};

export const maxURLRules = 50;
export const maxScrubPatterns = 25;
export const maxSensitiveKeys = 50;

export function getURLRules(projectId: string, signal?: AbortSignal) {
  return apiFetch<URLRules>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/url-rules`,
    { signal },
    protectedRequest,
  );
}

export function updateURLRules(projectId: string, input: URLRules) {
  return apiFetch<URLRules>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/url-rules`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

export function getScrubRules(projectId: string, signal?: AbortSignal) {
  return apiFetch<ScrubRules>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/scrub-rules`,
    { signal },
    protectedRequest,
  );
}

export function updateScrubRules(projectId: string, input: ScrubRules) {
  return apiFetch<ScrubRules>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/scrub-rules`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

// Readable in the stored document and unique without a round trip, so a rule
// can be added and removed again before anything is saved.
export function newRuleID(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
