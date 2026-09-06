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

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  allowedOrigins: string[];
  environment: string;
  retentionDays: number;
  eventSampleRate: number;
  apiSampleRate: number;
  status: ProjectStatus;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
  writeKey?: string;
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

export function createProject(
  organizationId: string,
  input: {
    name: string;
    slug: string;
    allowedOrigins: string[];
    environment: string;
    retentionDays: number;
    eventSampleRate: number;
    apiSampleRate: number;
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

export function updateProject(
  projectId: string,
  input: { eventSampleRate?: number; apiSampleRate?: number },
) {
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
