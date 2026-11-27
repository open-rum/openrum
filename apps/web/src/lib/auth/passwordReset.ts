import { apiFetch } from "./session";

const publicRequest = { redirectOnUnauthorized: false } as const;

export type PasswordResetStatus = {
  /** Whether the instance has a configured mail server and can send reset links. */
  enabled: boolean;
};

export const passwordResetStatusQueryKey = ["auth", "password-reset", "status"] as const;

export function getPasswordResetStatus(signal?: AbortSignal) {
  return apiFetch<PasswordResetStatus>(
    "/api/v1/auth/password-reset/status",
    { signal },
    publicRequest,
  );
}

export function requestPasswordReset(email: string) {
  return apiFetch<{ status: "reset_sent" }>(
    "/api/v1/auth/password-reset/request",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    publicRequest,
  );
}

export function confirmPasswordReset(input: { token: string; password: string }) {
  return apiFetch<void>(
    "/api/v1/auth/password-reset/confirm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    publicRequest,
  );
}
