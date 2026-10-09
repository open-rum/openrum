import { apiFetch, csrfHeaders } from "@/lib/auth/session";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
};

export type ProjectStatus = "active" | "disabled" | "deleting";
export type SDKPlatform = "javascript" | "react" | "vue" | "nextjs" | "nuxt" | "angular" | "svelte";

export type OverLimitBehavior = "reject" | "sample";

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  sdkPlatform: SDKPlatform;
  allowedOrigins: string[];
  /** Default environment selected when the project opens. */
  environment: string;
  /** Environments accepted by Ingest for this project. */
  environments: string[];
  retentionDays: number;
  eventSampleRate: number;
  apiSampleRate: number;
  errorSampleRate: number;
  /** Null when the project has no override and the instance default applies. */
  ingestRateLimit: number | null;
  overLimitBehavior: OverLimitBehavior;
  /** What "default" currently means, so the Console does not hard-code it. */
  defaultIngestRateLimit: number;
  status: ProjectStatus;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
  dsn?: string;
};

export type ProjectDataPurgeStatus =
  "idle" | "queued" | "running" | "retry" | "verifying" | "completed" | "failed";

export type ProjectDataPurge = {
  projectId: string;
  status: ProjectDataPurgeStatus;
  attempts: number;
  lastError: string;
  deadlineAt?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
};

export type OrganizationMember = {
  userId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
};

const protectedRequest = { redirectOnUnauthorized: true } as const;

export function listOrganizations() {
  return apiFetch<{ organizations: Organization[] }>("/api/v1/organizations", {}, protectedRequest);
}

export function createOrganization(input: { name: string; slug: string }) {
  return apiFetch<Organization>(
    "/api/v1/organizations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

export function listProjects(organizationId: string) {
  return apiFetch<{ projects: Project[] }>(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/projects`,
    {},
    protectedRequest,
  );
}

export type ReportedEnvironment = { name: string; lastSeenAt: string };

/** Environments that have actually reported data for the project, most recent first. */
export function getReportedEnvironments(projectId: string, signal?: AbortSignal) {
  return apiFetch<{ environments: ReportedEnvironment[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/environments`,
    { signal },
    protectedRequest,
  );
}

export function getProject(projectId: string, signal?: AbortSignal) {
  return apiFetch<Project>(
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    { signal },
    protectedRequest,
  );
}

export function createProject(
  organizationId: string,
  input: {
    name: string;
    sdkPlatform: SDKPlatform;
    allowedOrigins: string[];
    retentionDays: number;
    eventSampleRate: number;
    apiSampleRate: number;
    errorSampleRate: number;
  },
) {
  return apiFetch<Project>(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/projects`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

// Every field the PATCH endpoint accepts. Callers send only what changed, so
// the server keeps the rest untouched via COALESCE.
export type ProjectUpdate = {
  name?: string;
  sdkPlatform?: SDKPlatform;
  allowedOrigins?: string[];
  environment?: string;
  environments?: string[];
  retentionDays?: number;
  eventSampleRate?: number;
  apiSampleRate?: number;
  errorSampleRate?: number;
  /**
   * Omit to leave the override alone; send null to clear it back to the
   * instance default. The server distinguishes the two.
   */
  ingestRateLimit?: number | null;
  overLimitBehavior?: OverLimitBehavior;
  status?: Exclude<ProjectStatus, "deleting">;
};

export function updateProject(projectId: string, input: ProjectUpdate) {
  return apiFetch<Project>(
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

/** Permanently deletes the project's data; the project row is kept, marked deleting. */
export function deleteProject(projectId: string) {
  return apiFetch<{ status: "deleting"; deadlineHours: number }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE", headers: csrfHeaders() },
    protectedRequest,
  );
}

export function getProjectDataPurge(projectId: string, signal?: AbortSignal) {
  return apiFetch<ProjectDataPurge>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/data-purge`,
    { signal },
    protectedRequest,
  );
}

export function createProjectDataPurge(projectId: string, confirmation: string) {
  return apiFetch<ProjectDataPurge>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/data-purge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ confirmation }),
    },
    protectedRequest,
  );
}

export function listMembers(organizationId: string) {
  return apiFetch<{ members: OrganizationMember[] }>(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members`,
    {},
    protectedRequest,
  );
}

export function addMember(
  organizationId: string,
  input: { email: string; role: OrganizationRole },
) {
  return apiFetch<OrganizationMember>(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

export function updateMemberRole(organizationId: string, userId: string, role: OrganizationRole) {
  return apiFetch<OrganizationMember>(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ role }),
    },
    protectedRequest,
  );
}

export function removeMember(organizationId: string, userId: string) {
  return apiFetch<void>(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: csrfHeaders() },
    protectedRequest,
  );
}

export function canManageProjects(role: OrganizationRole) {
  return role === "owner" || role === "admin";
}

export function canManageMembers(role: OrganizationRole) {
  return role === "owner" || role === "admin";
}
