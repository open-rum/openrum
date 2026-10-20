import { apiFetch, csrfHeaders } from "@/lib/auth/session";
import type { OrganizationRole } from "./projects";

const protectedRequest = { redirectOnUnauthorized: true } as const;
const publicRequest = { redirectOnUnauthorized: false } as const;

/** A link can offer any role but Owner. */
export type InvitationRole = Exclude<OrganizationRole, "owner">;

export const INVITATION_DAYS = 7;

export type Invitation = {
  id: string;
  role: InvitationRole;
  /** Where the link was mailed; a record, not a restriction. */
  email: string | null;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
};

export type InvitationList = { invitations: Invitation[]; emailEnabled: boolean };

export type InvitationDelivery = {
  success: boolean;
  recipient: string;
  stage?: string;
  message?: string;
};

export type CreatedInvitation = {
  invitation: Invitation;
  link: string;
  delivery?: InvitationDelivery;
};

export type JoinRequest = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  avatar?: string;
  role: OrganizationRole;
  createdAt: string;
};

export type InvitationPreview = {
  organizationName: string;
  inviterName: string | null;
  role: InvitationRole;
  state: "valid" | "expired" | "revoked";
};

export type JoinOutcome = "requested" | "already_requested" | "already_member";

export const invitationsQueryKey = (organizationId: string) =>
  ["organization-invitations", organizationId] as const;

function organizationPath(organizationId: string) {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}`;
}

export function listInvitations(organizationId: string, signal?: AbortSignal) {
  return apiFetch<InvitationList>(
    `${organizationPath(organizationId)}/invitations`,
    { signal },
    protectedRequest,
  );
}

export function createInvitation(
  organizationId: string,
  input: { role: InvitationRole; email?: string },
) {
  return apiFetch<CreatedInvitation>(
    `${organizationPath(organizationId)}/invitations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}

export function revokeInvitation(organizationId: string, invitationId: string) {
  return apiFetch<void>(
    `${organizationPath(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE", headers: csrfHeaders() },
    protectedRequest,
  );
}

export function listJoinRequests(organizationId: string, signal?: AbortSignal) {
  return apiFetch<{ requests: JoinRequest[] }>(
    `${organizationPath(organizationId)}/join-requests`,
    { signal },
    protectedRequest,
  );
}

export function approveJoinRequest(
  organizationId: string,
  requestId: string,
  role: OrganizationRole,
) {
  return apiFetch<void>(
    `${organizationPath(organizationId)}/join-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ role }),
    },
    protectedRequest,
  );
}

export function rejectJoinRequest(organizationId: string, requestId: string) {
  return apiFetch<void>(
    `${organizationPath(organizationId)}/join-requests/${encodeURIComponent(requestId)}/reject`,
    { method: "POST", headers: csrfHeaders() },
    protectedRequest,
  );
}

export function getInvitationPreview(token: string, signal?: AbortSignal) {
  return apiFetch<InvitationPreview>(
    `/api/v1/invitations/${encodeURIComponent(token)}`,
    { signal },
    publicRequest,
  );
}

export function registerWithInvitation(
  token: string,
  input: { email: string; displayName: string; password: string },
) {
  return apiFetch<{ userId: string; organizationName: string }>(
    `/api/v1/invitations/${encodeURIComponent(token)}/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    publicRequest,
  );
}

export function joinWithInvitation(token: string) {
  return apiFetch<{ outcome: JoinOutcome; organizationName: string }>(
    `/api/v1/invitations/${encodeURIComponent(token)}/join`,
    { method: "POST", headers: csrfHeaders() },
    publicRequest,
  );
}

/** The sign-in address for someone who already has an account, back to this invitation. */
export function invitationLoginHref(token: string) {
  const returnTo = `/invite/${encodeURIComponent(token)}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
