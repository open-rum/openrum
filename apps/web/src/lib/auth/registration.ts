import { apiFetch, csrfHeaders } from "./session";

const publicRequest = { redirectOnUnauthorized: false } as const;
const protectedRequest = { redirectOnUnauthorized: true } as const;

/** Which sign-up methods the sign-in and registration pages should offer. */
export type RegistrationStatus = {
  /** Anyone may create an account without an invitation. */
  open: boolean;
  /** The email form works: registration is open and a mail server can send the link. */
  email: boolean;
};

export type AdminRegistration = {
  open: boolean;
  emailEnabled: boolean;
  mailConfigured: boolean;
  updatedAt: string | null;
};

export type ExternalProfile = { providerLabel: string; displayName: string };

export const registrationStatusQueryKey = ["auth", "registration"] as const;
export const adminRegistrationQueryKey = ["admin", "registration"] as const;

export function getRegistrationStatus(signal?: AbortSignal) {
  return apiFetch<RegistrationStatus>("/api/v1/auth/registration", { signal }, publicRequest);
}

function post<T>(path: string, body: unknown) {
  return apiFetch<T>(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    publicRequest,
  );
}

export function registerWithEmail(input: { email: string; displayName: string; password: string }) {
  return post<{ status: "verification_sent" }>("/api/v1/auth/register", input);
}

export function resendVerification(email: string) {
  return post<{ status: "verification_sent" }>("/api/v1/auth/register/resend", { email });
}

export function verifyEmail(token: string) {
  return post<{ userId: string; accessStatus: "approved" }>("/api/v1/auth/register/verify", {
    token,
  });
}

export function getExternalProfile(signal?: AbortSignal) {
  return apiFetch<ExternalProfile>("/api/v1/auth/register/external", { signal }, publicRequest);
}

export function completeExternalRegistration(input: { email: string; displayName: string }) {
  return post<{ returnTo: string; accessStatus: "approved" | "pending" }>(
    "/api/v1/auth/register/external",
    input,
  );
}

export function getAdminRegistration(signal?: AbortSignal) {
  return apiFetch<AdminRegistration>("/api/v1/admin/registration", { signal }, protectedRequest);
}

export function setAdminRegistration(open: boolean) {
  return apiFetch<void>(
    "/api/v1/admin/registration",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ open }),
    },
    protectedRequest,
  );
}
