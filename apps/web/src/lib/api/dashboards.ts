import { z } from "zod";
import { dashboardConfigSchema, type DashboardConfig } from "@/features/dashboard/model";
import { csrfHeaders } from "@/lib/auth/session";
import { requestJSON } from "./client";

// Named, personal dashboards: several per user and Project. Each one keeps its own
// revision, so a save only conflicts with an edit of the same dashboard.

export const dashboardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  revision: z.number().int(),
  widgetCount: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const namedDashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  config: dashboardConfigSchema,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type NamedDashboard = z.infer<typeof namedDashboardSchema>;

const listSchema = z.object({ dashboards: z.array(dashboardSummarySchema) });

export const MAX_DASHBOARDS = 20;

const base = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/dashboards`;
const json = () => ({ "Content-Type": "application/json", ...csrfHeaders() });

export function listDashboards(projectId: string, signal?: AbortSignal) {
  return requestJSON(listSchema, base(projectId), { signal }).then((result) => result.dashboards);
}

export function getNamedDashboard(projectId: string, dashboardId: string, signal?: AbortSignal) {
  return requestJSON(
    namedDashboardSchema,
    `${base(projectId)}/${encodeURIComponent(dashboardId)}`,
    { signal },
  );
}

export function createDashboard(projectId: string, name: string, config: DashboardConfig) {
  return requestJSON(namedDashboardSchema, base(projectId), {
    method: "POST",
    headers: json(),
    body: JSON.stringify({ name, config }),
  });
}

export function saveDashboardConfig(
  projectId: string,
  dashboardId: string,
  config: DashboardConfig,
  revision: number,
) {
  return requestJSON(
    namedDashboardSchema,
    `${base(projectId)}/${encodeURIComponent(dashboardId)}/config`,
    {
      method: "PUT",
      headers: json(),
      body: JSON.stringify({ config, revision }),
    },
  );
}

export function renameDashboard(projectId: string, dashboardId: string, name: string) {
  return requestJSON(
    namedDashboardSchema,
    `${base(projectId)}/${encodeURIComponent(dashboardId)}`,
    {
      method: "PATCH",
      headers: json(),
      body: JSON.stringify({ name }),
    },
  );
}

/** Copies on the server, byte for byte, so modules this Console cannot read survive. */
export function duplicateDashboard(projectId: string, dashboardId: string, name: string) {
  return requestJSON(
    namedDashboardSchema,
    `${base(projectId)}/${encodeURIComponent(dashboardId)}/duplicate`,
    {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ name }),
    },
  );
}

export function reorderDashboards(projectId: string, ids: string[]) {
  return requestJSON(listSchema, `${base(projectId)}/order`, {
    method: "PUT",
    headers: json(),
    body: JSON.stringify({ ids }),
  }).then((result) => result.dashboards);
}

/** A 204 has no body, which requestJSON reads as null — so errors keep their HTTP codes. */
export function deleteDashboard(projectId: string, dashboardId: string) {
  return requestJSON(z.null(), `${base(projectId)}/${encodeURIComponent(dashboardId)}`, {
    method: "DELETE",
    headers: csrfHeaders(),
  });
}

const lastUsedKey = (userId: string, projectId: string) =>
  `openrum-dashboard:${userId}:${projectId}`;

/** The dashboard a bare overview link opens. Kept per device: viewing never writes to the server. */
export function readLastDashboard(userId: string, projectId: string): string | null {
  try {
    return window.localStorage.getItem(lastUsedKey(userId, projectId));
  } catch {
    return null;
  }
}

export function rememberLastDashboard(userId: string, projectId: string, dashboardId: string) {
  try {
    window.localStorage.setItem(lastUsedKey(userId, projectId), dashboardId);
  } catch {
    // Storage can be unavailable in hardened or private browsing contexts.
  }
}
