import { apiFetch, csrfHeaders, type SessionUser } from "./session";

export type AuthMethod = {
  id: string;
  kind: "google" | "github" | "oidc" | "ldap";
  label: string;
};

export type AuthMethods = { local: true; providers: AuthMethod[] };

export type ProviderSettings = {
  clientId?: string;
  issuerUrl?: string;
  ldapUrl?: string;
  baseDn?: string;
  bindDn?: string;
  userFilter?: string;
  idAttribute?: string;
  emailAttribute?: string;
  nameAttribute?: string;
  caCertificate?: string;
};

export type AdminAuthProvider = AuthMethod & {
  enabled: boolean;
  configured: boolean;
  version: number;
  settings: ProviderSettings;
};

export type AdminAuthentication = {
  managedSecretsAvailable: boolean;
  providers: AdminAuthProvider[];
};

type AuthorizationStart = { authorizationUrl: string };
type LDAPLogin = SessionUser & { returnTo: string };

export function getAuthMethods(signal?: AbortSignal) {
  return apiFetch<AuthMethods>("/api/v1/auth/methods", { signal });
}

export function startOAuthLogin(providerId: string, returnTo: string) {
  return apiFetch<AuthorizationStart>(
    `/api/v1/auth/providers/${encodeURIComponent(providerId)}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnTo }),
    },
  );
}

export function loginLDAP(
  providerId: string,
  input: { username: string; password: string; returnTo: string },
) {
  return apiFetch<LDAPLogin>(
    `/api/v1/auth/providers/${encodeURIComponent(providerId)}/ldap/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function getLinkedIdentities(signal?: AbortSignal) {
  return apiFetch<{
    identities: Array<{ id: string; providerId: string; kind: AuthMethod["kind"]; label: string }>;
  }>("/api/v1/auth/identities", { signal }, { redirectOnUnauthorized: true });
}

export function startOAuthLink(providerId: string) {
  return apiFetch<AuthorizationStart>(
    `/api/v1/auth/providers/${encodeURIComponent(providerId)}/link`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({}),
    },
    { redirectOnUnauthorized: true },
  );
}

export function linkLDAP(providerId: string, username: string, password: string) {
  return apiFetch<void>(
    `/api/v1/auth/providers/${encodeURIComponent(providerId)}/ldap/link`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ username, password }),
    },
    { redirectOnUnauthorized: true },
  );
}

export function unlinkIdentity(identityId: string) {
  return apiFetch<void>(
    `/api/v1/auth/identities/${encodeURIComponent(identityId)}`,
    { method: "DELETE", headers: csrfHeaders() },
    { redirectOnUnauthorized: true },
  );
}

export function setInitialPassword(password: string) {
  return apiFetch<void>(
    "/api/v1/auth/password/set",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ password }),
    },
    { redirectOnUnauthorized: true },
  );
}

export function getAdminAuthentication(signal?: AbortSignal) {
  return apiFetch<AdminAuthentication>(
    "/api/v1/admin/authentication",
    { signal },
    { redirectOnUnauthorized: true },
  );
}

export function saveAdminProvider(
  providerId: string,
  input: {
    kind: AuthMethod["kind"];
    label: string;
    enabled: boolean;
    settings: ProviderSettings;
    secret?: string;
  },
) {
  return apiFetch<void>(
    `/api/v1/admin/authentication/providers/${encodeURIComponent(providerId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    { redirectOnUnauthorized: true },
  );
}

export function disableAdminProvider(providerId: string) {
  return apiFetch<void>(
    `/api/v1/admin/authentication/providers/${encodeURIComponent(providerId)}`,
    {
      method: "DELETE",
      headers: csrfHeaders(),
    },
    { redirectOnUnauthorized: true },
  );
}

export function testAdminProvider(providerId: string) {
  return apiFetch<{ connected?: boolean; authorizationUrl?: string }>(
    `/api/v1/admin/authentication/providers/${encodeURIComponent(providerId)}/test`,
    {
      method: "POST",
      headers: csrfHeaders(),
    },
    { redirectOnUnauthorized: true },
  );
}
