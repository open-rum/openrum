import { queryOptions } from "@tanstack/react-query";

export type SessionUser = {
  userId: string;
  email: string;
  displayName: string;
};

export type SetupStatus = { initialized: boolean };

type ErrorEnvelope = {
  error?: { code?: string; message?: string; requestId?: string };
};

export class HTTPError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    message: string,
  ) {
    super(message);
  }
}

type APIOptions = {
  redirectOnUnauthorized?: boolean;
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: APIOptions = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ErrorEnvelope | null;
    const error = new HTTPError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.requestId ?? response.headers.get("X-Request-ID") ?? "",
      payload?.error?.message ?? "请求失败，请稍后重试。",
    );
    if (response.status === 401 && options.redirectOnUnauthorized) redirectToLogin(true);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: ["auth", "session"] as const,
    queryFn: ({ signal }) =>
      apiFetch<SessionUser>("/api/v1/auth/me", { signal }, { redirectOnUnauthorized: false }),
    retry: false,
    staleTime: 60_000,
  });
}

export function getSetupStatus(signal?: AbortSignal) {
  return apiFetch<SetupStatus>(
    "/api/v1/setup/status",
    { signal },
    { redirectOnUnauthorized: false },
  );
}

export function login(input: { email: string; password: string }) {
  return apiFetch<SessionUser>(
    "/api/v1/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    { redirectOnUnauthorized: false },
  );
}

export function bootstrap(input: {
  email: string;
  displayName: string;
  password: string;
  organizationName: string;
  bootstrapToken?: string;
}) {
  const { bootstrapToken, ...body } = input;
  return apiFetch<{ userId: string; organizationId: string }>(
    "/api/v1/setup/bootstrap",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bootstrapToken ? { "X-OpenRUM-Bootstrap-Token": bootstrapToken } : {}),
      },
      body: JSON.stringify(body),
    },
    { redirectOnUnauthorized: false },
  );
}

export function logout() {
  return apiFetch<void>(
    "/api/v1/auth/logout",
    { method: "POST", headers: csrfHeaders() },
    { redirectOnUnauthorized: false },
  );
}

export function csrfHeaders(): HeadersInit {
  return { "X-CSRF-Token": readCookie("openrum_csrf") };
}

export function safeReturnTo(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return fallback;
    if (target.pathname === "/login" || target.pathname === "/setup") return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function redirectToLogin(expired: boolean) {
  if (window.location.pathname === "/login") return;
  const current = safeReturnTo(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  const parameters = new URLSearchParams({ returnTo: current });
  if (expired) parameters.set("expired", "1");
  window.location.assign(`/login?${parameters.toString()}`);
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const value = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}
